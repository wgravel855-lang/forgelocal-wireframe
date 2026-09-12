#!/usr/bin/env node
// @ts-check
/**
 * The runtime sidecar.
 *
 * One process, spoken to over stdin and stdout in newline-delimited JSON. It
 * owns sessions, orchestrators, providers and the project root; the Rust host
 * owns its lifetime and the native dialogs. Nothing here listens on a socket,
 * so there is no unauthenticated local port to find.
 *
 * The first thing it does is take stdout away from console. Every log a
 * dependency writes would otherwise land in the middle of a frame and desync
 * the stream, and that failure looks like a protocol bug rather than a stray
 * print.
 */

import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { canonicalRoot, PathEscape } from "../core/paths.mjs";
import { createOrchestrator, StopReason } from "../core/orchestrator.mjs";
import { createOpenAIProvider } from "../core/providers/openai.mjs";
import { ProviderFailure } from "../core/providers/types.mjs";
import { normalizeMode, MODE_COPY } from "../core/permissions.mjs";
import { classifyCommand, Danger } from "../core/danger.mjs";
import {
  PROTOCOL_VERSION, Request, Notify, ErrorCode,
  invalidRequest, notify, encode, createDecoder,
} from "./protocol.mjs";

/* stdout belongs to the protocol. */
const out = process.stdout;
const log = (...args) => process.stderr.write(`${args.join(" ")}\n`);
console.log = log;
console.info = log;
console.warn = log;
console.error = log;
console.debug = log;

const send = (frame) => { out.write(encode(frame)); };

/** @type {Map<string, any>} */
const sessions = new Map();
/** @type {{provider: any, info: any}|null} */
let provider = null;

// ------------------------------------------------------------------ helpers

/** Anything unexpected is reported, never swallowed into a success. */
function fail(id, code, message, sessionId = null) {
  send(notify(Notify.TURN_FAILED, { code, message }, { id, sessionId }));
}

/**
 * The permission prompt's content. The classification comes from the same
 * function the policy uses, so the risk shown to the user and the risk that
 * gates execution cannot disagree.
 * @param {any} payload
 */
function permissionCard(payload) {
  const args = payload.args ?? {};
  const isCommand = payload.tool === "run_command";
  const danger = isCommand ? classifyCommand(args.argv ?? []) : { level: Danger.ORDINARY, reason: "" };
  return {
    requestId: payload.request_id,
    toolCallId: payload.tool_call_id,
    tool: payload.tool,
    action: isCommand ? (args.argv ?? []).join(" ")
      : payload.tool === "apply_patch"
        ? (args.edits ?? []).map((e) => `${e.operation} ${e.path}`).join(", ")
        : JSON.stringify(args).slice(0, 200),
    target: isCommand ? null : (args.edits ?? []).map((e) => e.path),
    cwd: args.cwd ?? null,
    purpose: args.purpose ?? payload.reason ?? null,
    reason: payload.reason,
    risk: danger.level,
    riskReason: danger.reason || null,
    // "approve_for_session" is absent for anything the classifier flags, so a
    // dangerous command is decided every single time it is asked.
    options: payload.options ?? [],
    mode: payload.mode,
    modeCopy: MODE_COPY[normalizeMode(payload.mode)] ?? null,
  };
}

// ----------------------------------------------------------------- handlers

async function handle(frame) {
  const bad = invalidRequest(frame);
  if (bad) return fail(frame?.id ?? "unknown", bad.code, bad.message);

  const { id, type, sessionId } = frame;
  const payload = frame.payload ?? {};

  switch (type) {
    case Request.PROVIDER_CONNECT: return providerConnect(id, payload);
    case Request.PROVIDER_DISCONNECT: return providerDisconnect(id);
    case Request.SESSION_CREATE: return sessionCreate(id, payload);
    case Request.SESSION_DISPOSE: return sessionDispose(id, sessionId);
    case Request.TURN_START: return turnStart(id, sessionId, payload);
    case Request.TURN_CANCEL: return turnCancel(id, sessionId);
    case Request.PERMISSION_RESOLVE: return permissionResolve(id, sessionId, payload);
    case Request.QUESTION_ANSWER: return questionAnswer(id, sessionId, payload);
    default: return fail(id, ErrorCode.UNKNOWN_TYPE, `Unhandled type ${type}`);
  }
}

async function providerConnect(id, payload) {
  const baseUrl = typeof payload.baseUrl === "string" && payload.baseUrl
    ? payload.baseUrl : "http://127.0.0.1:1234/v1";
  const model = typeof payload.model === "string" ? payload.model : null;

  // Probing with no model named lists what is loaded, which is how the picker
  // gets real models instead of a catalogue of things that may not exist here.
  const p = createOpenAIProvider({ baseUrl, model: model ?? "", contextWindow: payload.contextWindow ?? null });
  try {
    const probe = await p.probe();
    provider = { provider: model ? createOpenAIProvider({ baseUrl, model, contextWindow: payload.contextWindow ?? null }) : null, info: { baseUrl, models: probe.models, model } };
    send(notify(Notify.PROVIDER_STATE, {
      connected: true, baseUrl, models: probe.models, model,
      capabilities: probe.capabilities,
    }, { id }));
  } catch (e) {
    const kind = e instanceof ProviderFailure ? e.kind : "unknown";
    provider = null;
    send(notify(Notify.PROVIDER_STATE, {
      connected: false, baseUrl, models: [], model: null,
      error: { code: kind, message: e && e.message ? e.message : "Could not reach the inference server." },
      // MODEL_MISSING carries what *is* loaded, which is the useful half.
      available: (e && e.detail && e.detail.available) || [],
    }, { id }));
  }
}

function providerDisconnect(id) {
  provider = null;
  send(notify(Notify.PROVIDER_STATE, { connected: false, models: [], model: null }, { id }));
}

async function sessionCreate(id, payload) {
  if (!provider || !provider.provider) {
    return fail(id, ErrorCode.PROVIDER,
      "Connect to a model before starting a session. Nothing can run without one.");
  }
  let root;
  try {
    root = canonicalRoot(String(payload.root ?? ""));
  } catch (e) {
    return fail(id, ErrorCode.BAD_ARGUMENT,
      e instanceof PathEscape ? e.message : "That project folder could not be opened.");
  }

  const sessionId = randomUUID();
  const state = {
    id: sessionId, root, mode: normalizeMode(payload.mode),
    agent: null, running: false,
  };

  state.agent = createOrchestrator({
    root, provider: provider.provider, mode: state.mode, sessionId,
    paths: { snapshotDir: join(root, ".forgelocal", "snapshots") },
    onEvent: (event) => {
      send(notify(Notify.AGENT_EVENT, event, { sessionId }));
      // The two events the interface has to act on rather than just draw.
      if (event.type === "permission_required") {
        send(notify(Notify.PERMISSION_REQUESTED, permissionCard(event.payload), { sessionId }));
      }
      if (event.type === "tool_completed" && event.payload?.result?.awaiting) {
        // handled through the orchestrator's own stop reason below
      }
    },
  });
  state.agent.start();
  sessions.set(sessionId, state);

  send(notify(Notify.SESSION_CREATED, {
    sessionId, root, mode: state.mode, model: provider.info.model,
  }, { id, sessionId }));
}

function sessionDispose(id, sessionId) {
  const s = sessions.get(sessionId);
  if (s) { try { s.agent.stop(); } catch { /* already idle */ } }
  sessions.delete(sessionId);
  send(notify(Notify.TURN_COMPLETED, { disposed: true }, { id, sessionId }));
}

/** Every path that ends a turn funnels through here, so none can be forgotten. */
function settle(id, s, outcome) {
  s.running = false;
  if (outcome.stop === StopReason.AWAITING_PERMISSION) return; // the card was already sent
  if (outcome.stop === StopReason.AWAITING_ANSWER) {
    send(notify(Notify.QUESTION_REQUESTED, {
      question: outcome.detail?.question ?? "",
      options: outcome.detail?.options ?? [],
    }, { id, sessionId: s.id }));
    return;
  }
  send(notify(Notify.TURN_COMPLETED, {
    stop: outcome.stop, turnId: outcome.turnId, detail: outcome.detail ?? null,
  }, { id, sessionId: s.id }));
}

async function turnStart(id, sessionId, payload) {
  const s = sessions.get(sessionId);
  if (!s) return fail(id, ErrorCode.NO_SUCH_SESSION, "That session is gone.", sessionId);
  if (s.running) return fail(id, ErrorCode.BUSY, "That session is already running a turn.", sessionId);
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!text) return fail(id, ErrorCode.BAD_ARGUMENT, "An empty message has nothing to run.", sessionId);

  if (payload.mode) {
    s.mode = s.agent.setMode(payload.mode);
  }
  s.running = true;
  try {
    settle(id, s, await s.agent.send(text));
  } catch (e) {
    s.running = false;
    // A throw out of the loop is a runtime failure and is reported as one.
    // It never becomes an assistant message.
    fail(id, ErrorCode.INTERNAL, e && e.message ? e.message : "The runtime failed.", sessionId);
  }
}

function turnCancel(id, sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return fail(id, ErrorCode.NO_SUCH_SESSION, "That session is gone.", sessionId);
  s.agent.stop();
  // turn_cancelled arrives on the event stream; this only acknowledges receipt.
  send(notify(Notify.RUNTIME_STATE, { cancelling: true }, { id, sessionId }));
}

async function permissionResolve(id, sessionId, payload) {
  const s = sessions.get(sessionId);
  if (!s) return fail(id, ErrorCode.NO_SUCH_SESSION, "That session is gone.", sessionId);
  const decision = payload.decision;
  if (!["approve_once", "approve_for_session", "deny"].includes(decision)) {
    return fail(id, ErrorCode.BAD_ARGUMENT, `Unknown decision: ${String(decision)}`, sessionId);
  }
  s.running = true;
  try {
    settle(id, s, await s.agent.resolvePermission(String(payload.requestId ?? ""), decision));
  } catch (e) {
    s.running = false;
    fail(id, ErrorCode.BAD_ARGUMENT, e && e.message ? e.message : "That decision could not be applied.", sessionId);
  }
}

async function questionAnswer(id, sessionId, payload) {
  const s = sessions.get(sessionId);
  if (!s) return fail(id, ErrorCode.NO_SUCH_SESSION, "That session is gone.", sessionId);
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!text) return fail(id, ErrorCode.BAD_ARGUMENT, "An empty answer cannot resume the turn.", sessionId);
  s.running = true;
  try {
    settle(id, s, await s.agent.answer(text));
  } catch (e) {
    s.running = false;
    fail(id, ErrorCode.INTERNAL, e && e.message ? e.message : "The answer could not be applied.", sessionId);
  }
}

// -------------------------------------------------------------------- wiring

const decoder = createDecoder(
  (frame) => { handle(frame).catch((e) => fail(frame?.id ?? "unknown", ErrorCode.INTERNAL, String(e && e.message))); },
  (line, e) => {
    // A line that is not JSON is reported with no id, because there is no id to
    // report it against, and dropping it silently would strand the caller.
    send(notify(Notify.TURN_FAILED, {
      code: ErrorCode.BAD_FRAME,
      message: `Could not parse a frame: ${e.message}`,
      line: line.slice(0, 120),
    }, { id: null }));
  },
);

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => decoder.push(String(chunk)));
process.stdin.on("end", () => shutdown(0));

/** Losing the host means losing the reason to exist; every child goes too. */
function shutdown(code) {
  for (const s of sessions.values()) {
    try { s.agent.stop(); } catch { /* already idle */ }
  }
  sessions.clear();
  process.exit(code);
}
process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
process.on("uncaughtException", (e) => {
  // Report, then die. A sidecar that limps on after an unknown fault is worse
  // than one the host can see has crashed and restart.
  send(notify(Notify.RUNTIME_STATE, {
    connected: false, fatal: true,
    error: { code: ErrorCode.INTERNAL, message: e && e.message ? e.message : String(e) },
  }));
  log(e && e.stack ? e.stack : String(e));
  shutdown(1);
});

send(notify(Notify.RUNTIME_STATE, {
  connected: true, protocol: PROTOCOL_VERSION,
  pid: process.pid, node: process.version, platform: process.platform,
}));
