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
import { DEFAULT_GROUPS, ToolGroup } from "../core/tools/index.mjs";
import { createOpenAIProvider } from "../core/providers/openai.mjs";
import { ProviderFailure } from "../core/providers/types.mjs";
import { normalizeMode, MODE_COPY } from "../core/permissions.mjs";
import { classifyCommand, Danger } from "../core/danger.mjs";
import { openStore, defaultStoreDir, SessionStatus } from "../core/store.mjs";
import { openProfiles } from "../core/profiles.mjs";
import { runConformance, agentAllowed } from "../core/conformance.mjs";
import { emptyProfile, AgentGrade, browserModeFor } from "../core/capability.mjs";
import { summarise, renderSummary } from "../core/compact.mjs";
import { listModels, deleteModel, verifyModel, defaultModelDir } from "../core/models/files.mjs";
import { downloadModel, listRepoFiles } from "../core/models/download.mjs";
import { fitFor, suggestLoad } from "../core/models/fit.mjs";
import {
  installEngine, listEngines, removeEngine, engineDirName,
} from "../engine/install.mjs";
import { buildsFor, ENGINE_BUILD, isSupportedPlatform, totalBytes } from "../engine/manifest.mjs";
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

/**
 * Durable session state.
 *
 * Opened once, at boot, before anything can create a session. If it cannot
 * be opened the sidecar keeps working without it and says so on stderr: a
 * read-only disk should cost the user their history, not their agent.
 * `store` is null in that case and every call site checks.
 *
 * @type {any}
 */
let store = null;
try {
  store = openStore(defaultStoreDir());
  /* Anything still marked running was running when the host died. Doing this
     at boot, before any session exists, is what makes the distinction
     truthful: nothing live can be mislabelled because nothing is live yet. */
  const stale = store.markInterrupted();
  if (stale.interrupted) log(`sessions interrupted by a previous exit: ${stale.interrupted}`);
} catch (/** @type {any} */ e) {
  log(`session history is unavailable: ${e && e.message ? e.message : e}`);
}

/**
 * Conformance verdicts, remembered between launches.
 *
 * Separate from the session store because it answers a different question and
 * has a different lifetime: sessions are a record of what happened, and this
 * is a claim about what a model can be relied on to do.
 * @type {any}
 */
let profiles = null;
try {
  profiles = openProfiles(defaultStoreDir());
} catch (/** @type {any} */ e) {
  log(`capability profiles are unavailable: ${e && e.message ? e.message : e}`);
}

/** The run in flight, so a second request is refused rather than interleaved. */
/** @type {AbortController|null} */
let testing = null;

/**
 * ForgeLocal's own inference engine, when the desktop host has one running.
 *
 * The base URL and the session token arrive on the pipe from the Rust host and
 * are held here. They are never echoed to the renderer, never written to the
 * session store, and never put in an event: a bearer token in a transcript is
 * a bearer token in a backup.
 *
 * @type {{baseUrl: string, apiKey: string}|null}
 */
let engineEndpoint = null;

/**
 * Which tool groups a session may actually have.
 *
 * The renderer asks; this decides. A request arriving over the pipe is not a
 * grant, and putting the rule here rather than in the interface means a
 * renderer that has been tampered with — or simply one version out of date —
 * cannot turn on a capability the model has not earned.
 *
 * Three rules, in order of how much they take away:
 *
 *   - a model GRADED chat-only gets nothing. We know it cannot drive tools,
 *     and handing it a set it will mishandle produces a loop the user has to
 *     unpick. Conversation still works.
 *   - browsing needs a model the suite has graded. browserModeFor returns
 *     null for untested and for chat-only, and that is the gate. It is the
 *     most consequential surface the agent has, and "we have not checked" is
 *     not a good enough basis for handing it over.
 *   - anything else the caller asked for that is a real group is allowed, and
 *     the base four are always present: a loop that cannot read has nothing
 *     to reason from.
 *
 * @param {readonly string[]} requested @param {any} profile
 * @param {string|null} [root]  the session's project folder, if it has one
 * @returns {string[]}
 */
function allowedGroups(requested, profile, root = null) {
  if (profile && profile.agentGrade === AgentGrade.CHAT_ONLY) return [];

  /* No project, no tools. Every group except plan acts on a folder — reading,
     editing, running commands — and browsing is not something to hand a
     session the person opened to ask a question. This is what makes "you can
     chat without choosing a folder" safe rather than merely permitted: there
     is nothing for the agent to reach. */
  if (!root) return [];

  const known = new Set(Object.values(ToolGroup));
  const want = new Set([
    ...DEFAULT_GROUPS,
    ...(Array.isArray(requested) ? requested : []).filter((g) => known.has(g)),
  ]);

  if (!browserModeFor(profile ?? emptyProfile())) want.delete(ToolGroup.BROWSER);
  return [...want];
}

/** Record an event, never at the cost of delivering it. */
function persist(sessionId, event) {
  if (!store) return;
  try { store.appendEvent(sessionId, event); }
  catch (/** @type {any} */ e) { log(`could not store an event: ${e && e.message}`); }
}

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
    case Request.BROWSER_CONTROL: return browserControl(id, sessionId, payload);
    case Request.SESSION_LIST: return sessionList(id, payload);
    case Request.SESSION_RESUME: return sessionResume(id, payload);
    case Request.SESSION_SET_ROOT: return sessionSetRoot(id, sessionId, payload);
    case Request.MODEL_TEST: return modelTest(id, payload);
    case Request.MODEL_TEST_CANCEL: return modelTestCancel(id);
    case Request.ENGINE_ATTACHED: return engineAttached(id, payload);
    case Request.ENGINE_DETACHED: return engineDetached(id);
    case Request.MODEL_LIST: return modelList(id, payload);
    case Request.MODEL_DELETE: return modelDelete(id, payload);
    case Request.MODEL_SEARCH: return modelSearch(id, payload);
    case Request.MODEL_DOWNLOAD: return modelDownload(id, payload);
    case Request.MODEL_DOWNLOAD_CANCEL: return modelDownloadCancel(id, payload);
    case Request.MODEL_VERIFY: return modelVerify(id, payload);
    case Request.ENGINE_LIST: return engineList(id);
    case Request.ENGINE_INSTALL: return engineInstall(id, payload);
    case Request.ENGINE_INSTALL_CANCEL: return engineInstallCancel(id);
    case Request.ENGINE_REMOVE: return engineRemove(id, payload);
    default: return fail(id, ErrorCode.UNKNOWN_TYPE, `Unhandled type ${type}`);
  }
}

/* ------------------------------------------------------------- weights --- */

/**
 * Downloads in flight, by file name.
 *
 * Keyed by name rather than by request id so a second request for the same
 * file joins the existing download instead of starting a second one writing to
 * the same partial file.
 *
 * @type {Map<string, AbortController>}
 */
const downloading = new Map();

/**
 * What is on disk, and whether each one will run here.
 *
 * The hardware comes from the caller because only the desktop host can
 * measure it. The arithmetic stays here, in one place, rather than being
 * mirrored into the renderer: a second copy of "will this fit" is a second
 * answer waiting to disagree with the first.
 *
 * With no hardware, every model is listed with a null fit and the interface
 * says it does not know — not a default that would be wrong for most people.
 */
function modelList(id, payload = {}) {
  const hardware = payload.hardware ?? null;
  try {
    const models = listModels().map((m) => ({
      ...m,
      fit: hardware && m.usable ? fitFor({ fileBytes: m.bytes, hardware }) : null,
      suggested: hardware && m.usable ? suggestLoad({ fileBytes: m.bytes, hardware }) : null,
    }));
    send(notify(Notify.MODEL_LIST, {
      dir: defaultModelDir(),
      hardwareKnown: !!hardware,
      models,
    }, { id }));
  } catch (/** @type {any} */ e) {
    fail(id, ErrorCode.INTERNAL, `The models folder could not be read: ${e && e.message}`);
  }
}

function modelDelete(id, payload) {
  /* Resolved inside the models folder rather than taking a path. The renderer
     naming an arbitrary path to delete is exactly the authority it does not
     have. */
  const name = String(payload.name ?? "");
  const found = listModels().find((m) => m.name === name);
  if (!found) return fail(id, ErrorCode.BAD_ARGUMENT, `No model called ${name}.`);
  try {
    deleteModel(found.path);
    send(notify(Notify.MODEL_LIST, { dir: defaultModelDir(), models: listModels() }, { id }));
  } catch (/** @type {any} */ e) {
    fail(id, ErrorCode.INTERNAL, `It could not be deleted: ${e && e.message}`);
  }
}

async function modelSearch(id, payload) {
  const repo = String(payload.repo ?? "");
  try {
    const out = await listRepoFiles(repo);
    if (!out.ok) return fail(id, ErrorCode.BAD_ARGUMENT, out.reason);
    send(notify(Notify.MODEL_SEARCH, out, { id }));
  } catch (/** @type {any} */ e) {
    fail(id, ErrorCode.INTERNAL,
      `Hugging Face could not be reached: ${e && e.message ? e.message : e}`);
  }
}

async function modelDownload(id, payload) {
  const name = String(payload.name ?? "");
  if (downloading.has(name)) {
    return fail(id, ErrorCode.BUSY, `${name} is already downloading.`);
  }
  const controller = new AbortController();
  downloading.set(name, controller);

  try {
    const out = await downloadModel({
      url: String(payload.url ?? ""),
      name,
      bytes: typeof payload.bytes === "number" ? payload.bytes : null,
      sha256: typeof payload.sha256 === "string" ? payload.sha256 : null,
      signal: controller.signal,
      onProgress: (p) => {
        send(notify(Notify.MODEL_DOWNLOAD_PROGRESS, { name, ...p }, { id }));
      },
    });
    send(notify(Notify.MODEL_DOWNLOADED, { name, ...out }, { id }));
  } catch (/** @type {any} */ e) {
    send(notify(Notify.MODEL_DOWNLOADED, {
      name, ok: false,
      reason: `The download failed: ${e && e.message ? e.message : e}`,
    }, { id }));
  } finally {
    downloading.delete(name);
  }
}

function modelDownloadCancel(id, payload) {
  const name = String(payload.name ?? "");
  const c = downloading.get(name);
  if (!c) {
    return send(notify(Notify.MODEL_DOWNLOADED, {
      name, ok: false, reason: "That download is not running.",
    }, { id }));
  }
  /* The partial file survives. A cancel that threw away thirty gigabytes
     would make cancelling something people are afraid to do. */
  c.abort();
}

/* ------------------------------------------------------------- the engine */

/** The install in flight, if there is one. At most one: they are hundreds of
 *  megabytes and two at once would compete for the same staging directory. */
/** @type {AbortController|null} */
let installing = null;

/**
 * What is installed and what could be.
 *
 * Both halves, because the interface needs to say "you have this one, these
 * are the others" and computing the difference in the renderer would mean two
 * places that know the build list.
 */
async function engineList(id) {
  const installed = await listEngines();
  const available = buildsFor().map((b) => ({
    id: b.id, label: b.label, accel: b.accel, note: b.note,
    bytes: totalBytes(b),
    /* Installed-ness is per build *and* per acceleration, because the
       directory name is both. */
    installed: installed.some((e) => e.build === ENGINE_BUILD && e.id === b.id),
  }));
  send(notify(Notify.ENGINE_LIST, {
    build: ENGINE_BUILD,
    supported: isSupportedPlatform(),
    installed: installed.map((e) => ({
      dir: e.dir.split(/[\\/]/).pop(), build: e.build, id: e.id,
      bytes: e.bytes, installedAt: e.installedAt,
    })),
    available,
  }, { id }));
}

/**
 * Fetch and install one build.
 *
 * Progress is a notification rather than a reply because a CUDA install is
 * 645MB across two archives and produces thousands of ticks. The final frame
 * is sent on both paths, so an interface that is waiting for it is never left
 * waiting because the thing failed.
 */
async function engineInstall(id, payload) {
  if (installing) {
    return fail(id, ErrorCode.BUSY, "An engine is already being installed.");
  }
  const controller = new AbortController();
  installing = controller;
  try {
    const out = await installEngine({
      id: payload.id ? String(payload.id) : undefined,
      hardware: payload.hardware ?? null,
      signal: controller.signal,
      onProgress: (e) => send(notify(Notify.ENGINE_INSTALL_PROGRESS, e, { id })),
    });
    /* The path is not sent. The renderer has never needed to know where the
       engine lives and giving it one would be the first step towards it
       deciding which one to run. */
    send(notify(Notify.ENGINE_INSTALLED, {
      ok: true, build: out.build, id: out.id, reused: !!out.reused,
    }, { id }));
  } catch (/** @type {any} */ e) {
    const aborted = controller.signal.aborted;
    send(notify(Notify.ENGINE_INSTALLED, {
      ok: false,
      cancelled: aborted,
      reason: aborted
        ? "The engine download was cancelled. Nothing was installed."
        : `The engine could not be installed: ${e && e.message ? e.message : e}`,
    }, { id }));
  } finally {
    installing = null;
  }
}

function engineInstallCancel(id) {
  if (!installing) {
    return send(notify(Notify.ENGINE_INSTALLED, {
      ok: false, cancelled: true, reason: "No engine is being installed.",
    }, { id }));
  }
  installing.abort();
}

async function engineRemove(id, payload) {
  const dir = String(payload.dir ?? "");
  if (!/^[A-Za-z0-9._-]+$/.test(dir)) {
    return fail(id, ErrorCode.BAD_ARGUMENT, "That is not an engine name.");
  }
  const out = await removeEngine(dir);
  if (!out.ok) return fail(id, ErrorCode.BAD_ARGUMENT, out.reason);
  return engineList(id);
}

async function modelVerify(id, payload) {
  const name = String(payload.name ?? "");
  const found = listModels().find((m) => m.name === name);
  if (!found) return fail(id, ErrorCode.BAD_ARGUMENT, `No model called ${name}.`);
  try {
    const out = await verifyModel({
      path: found.path,
      expectedBytes: typeof payload.bytes === "number" ? payload.bytes : null,
      expectedSha256: typeof payload.sha256 === "string" ? payload.sha256 : null,
      onProgress: (done, total) => {
        send(notify(Notify.MODEL_DOWNLOAD_PROGRESS, {
          name, phase: "verifying", bytes: done, total,
        }, { id }));
      },
    });
    send(notify(Notify.MODEL_VERIFIED, { name, ...out }, { id }));
  } catch (/** @type {any} */ e) {
    fail(id, ErrorCode.INTERNAL, `It could not be checked: ${e && e.message}`);
  }
}

/**
 * The desktop host started the engine and is telling us where it is.
 *
 * Recorded, not connected to. Choosing a model is still a deliberate act, and
 * connecting here would mean a model became "the one in use" because a process
 * started rather than because anybody chose it.
 */
function engineAttached(id, payload) {
  const baseUrl = typeof payload.baseUrl === "string" ? payload.baseUrl : "";
  const apiKey = typeof payload.apiKey === "string" ? payload.apiKey : "";
  if (!/^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(baseUrl) || !apiKey) {
    /* Checked even though this frame can only come from the host. The host is
       trusted; a bug in it is not, and a malformed endpoint here would send
       every prompt somewhere unintended. */
    return fail(id, ErrorCode.BAD_ARGUMENT,
      "The engine endpoint was not a loopback address with a token.");
  }
  engineEndpoint = { baseUrl, apiKey };
  /* The renderer is told an engine exists. It is NOT told where or with what:
     the payload carries neither the URL nor the token. */
  send(notify(Notify.ENGINE_READY, { available: true }, { id }));
}

function engineDetached(id) {
  engineEndpoint = null;
  send(notify(Notify.ENGINE_READY, { available: false }, { id }));
}

async function providerConnect(id, payload) {
  /* Two sources, and the renderer names one rather than a URL.
   *
   * "internal" is ForgeLocal's own engine, whose address and token the host
   * gave us over the pipe. The renderer cannot supply either — that is the
   * point — so it asks for the source by name and this fills in the rest.
   *
   * "external" is LM Studio or anything else speaking the OpenAI API. It is
   * optional, it is the user's choice, and nothing in the product depends on
   * it any more. */
  const wantsInternal = payload.source === "internal";
  if (wantsInternal && !engineEndpoint) {
    return send(notify(Notify.PROVIDER_STATE, {
      connected: false, models: [], model: null, source: "internal",
      error: {
        code: "engine_not_running",
        message: "ForgeLocal's engine is not running. Load a model to start it.",
      },
    }, { id }));
  }

  /* Read once, after the guard above has established it is there. Reading
     the module-level binding twice would let a detach between the two
     produce a URL with no key. */
  const internal = wantsInternal ? engineEndpoint : null;
  const baseUrl = internal
    ? internal.baseUrl
    : (typeof payload.baseUrl === "string" && payload.baseUrl
      ? payload.baseUrl : "http://127.0.0.1:1234/v1");
  const apiKey = internal ? internal.apiKey : (payload.apiKey ?? undefined);
  const model = typeof payload.model === "string" ? payload.model : null;

  // Probing with no model named lists what is loaded, which is how the picker
  // gets real models instead of a catalogue of things that may not exist here.
  const p = createOpenAIProvider({ baseUrl, apiKey, model: model ?? "", contextWindow: payload.contextWindow ?? null });
  try {
    const probe = await p.probe();
    provider = {
      provider: model
        ? createOpenAIProvider({ baseUrl, apiKey, model, contextWindow: payload.contextWindow ?? null })
        : null,
      info: { baseUrl, models: probe.models, model, source: wantsInternal ? "internal" : "external" },
    };
    /* The stored verdict, if there is one for this model on this server.
       Never a fresh grade: connecting proves the server answers, which is a
       different question from whether the model can drive a loop. A model
       with no stored profile is reported as untested and agent features stay
       off until somebody runs the suite. */
    const known = model && profiles ? profiles.get(baseUrl, model) : null;
    send(notify(Notify.PROVIDER_STATE, {
      connected: true,
      /* The internal engine's address is not reported. It changes every launch,
         nothing in the interface can use it, and half of an authenticated pair
         is not a thing to hand to a WebView. */
      baseUrl: wantsInternal ? null : baseUrl,
      source: wantsInternal ? "internal" : "external",
      models: probe.models, model,
      capabilities: probe.capabilities,
      profile: known ?? (model ? emptyProfile({ model, baseUrl }) : null),
      agentReady: agentAllowed(known),
    }, { id }));
  } catch (/** @type {any} */ e) {
    const kind = e instanceof ProviderFailure ? e.kind : "unknown";
    provider = null;
    send(notify(Notify.PROVIDER_STATE, {
      connected: false,
      baseUrl: wantsInternal ? null : baseUrl,
      source: wantsInternal ? "internal" : "external",
      models: [], model: null,
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
  /* A project is optional.
   *
   * Without one this is a conversation: the person can ask a question without
   * first nominating a folder, which is the ordinary thing to want and was
   * previously impossible. What they cannot do is have the agent touch
   * anything, and allowedGroups below is where that is enforced rather than
   * hoped for. */
  /** @type {string|null} */
  let root = null;
  if (payload.root) {
    try {
      root = canonicalRoot(String(payload.root));
    } catch (/** @type {any} */ e) {
      return fail(id, ErrorCode.BAD_ARGUMENT,
        e instanceof PathEscape ? e.message : "That project folder could not be opened.");
    }
  }

  const sessionId = randomUUID();
  const state = build(provider.provider, sessionId, root, normalizeMode(payload.mode), null);
  state.agent.start();

  if (store) {
    try {
      store.createSession({
        /* The store column is NOT NULL, so no project is recorded as an
           empty string rather than a null. Every reader treats a falsy root
           the same way, and this avoids a schema change that an existing
           database would not pick up. */
        id: sessionId, root: root ?? "", mode: state.mode,
        model: provider.info.model, title: null,
      });
    } catch (/** @type {any} */ e) {
      log(`could not record the session: ${e && e.message}`);
    }
  }

  send(notify(Notify.SESSION_CREATED, {
    sessionId, root, mode: state.mode, model: provider.info.model, resumed: false,
    /* Said explicitly rather than left for the interface to infer from a null
       root, so a session that cannot act never looks like one that can. */
    canAct: !!root,
    groups: state.agent.groups,
  }, { id, sessionId }));
}

/**
 * Build a session and its orchestrator.
 *
 * Shared by session.create and session.resume so a reopened session is built
 * by exactly the same code as a new one. The only difference between them is
 * `restored`, which carries what the earlier run was for.
 *
 * The provider is passed rather than read from the module global, so a
 * session is bound to the provider its caller checked. Reading the global
 * here would leave a window in which a provider.disconnect between the check
 * and the build hands the orchestrator a null it will only discover mid-turn.
 *
 * @param {any} model  the connected provider
 * @param {string} sessionId
 * @param {string|null} root  the project folder, or null for a conversation
 * @param {string} mode
 * @param {{summary: string|null, objective: string}|null} restored
 */
function build(model, sessionId, root, mode, restored) {
  /** @type {any} */
  const state = { id: sessionId, root, mode, agent: null, running: false };

  /* What the suite found, or nothing. The orchestrator uses it for two
     things: the prompt's capabilities layer, which tells the model what it is
     known to be bad at, and browser_screenshot, which declines rather than
     handing an image to a model that cannot see one. */
  const profile = profiles && provider
    ? profiles.get(provider.info.baseUrl, provider.info.model)
    : null;

  /* Which tools this session gets.
   *
   * Three cases, and the middle one is the judgement call.
   *
   * A model GRADED chat-only is offered no tools at all. We know it cannot
   * drive them; handing it a set it will mishandle produces a loop that fails
   * in ways the user has to unpick, and the honest product is a chat window
   * that works.
   *
   * An UNTESTED model gets the ordinary tools. "We have not checked" is not
   * "we know it cannot", and refusing to run until somebody sits through ten
   * prompts would make a fresh install useless. The interface says plainly
   * that it is untested and offers the suite.
   *
   * Browsing is never in the default set. It is opt-in per session, and only
   * for a model the suite has actually graded — browserModeFor returns null
   * for untested and chat-only, which is what gates it.
   */
  const groups = allowedGroups(DEFAULT_GROUPS, profile, root);

  state.agent = createOrchestrator({
    root, provider: model, mode, sessionId, restored, capabilities: profile, groups,
    paths: {
      /* Checkpoints live in the project, so a session without one has
         nowhere to put them — and nothing to checkpoint either, since it
         has no tools that write. */
      snapshotDir: root ? join(root, ".forgelocal", "snapshots") : undefined,
      downloadDir: join(defaultStoreDir(), "downloads", sessionId),
    },
    onEvent: (event) => {
      /* Stored before it is sent. If the process dies between the two, the
         record is ahead of the interface rather than behind it, and the
         interface is the thing that can be rebuilt. */
      persist(sessionId, event);
      send(notify(Notify.AGENT_EVENT, event, { sessionId }));
      if (event.type === "permission_required") {
        send(notify(Notify.PERMISSION_REQUESTED, permissionCard(event.payload), { sessionId }));
      }
    },
  });

  sessions.set(sessionId, state);
  return state;
}

/**
 * List what is on disk, newest first.
 *
 * Enough for a session list and no more: no events, no payloads. A sidebar
 * showing forty sessions must not read forty transcripts to draw itself.
 */
function sessionList(id, payload) {
  if (!store) {
    return send(notify(Notify.SESSION_LIST, {
      sessions: [], available: false,
      reason: "Session history could not be opened on this machine.",
    }, { id }));
  }
  const limit = Math.min(200, Math.max(1, Number(payload.limit) || 50));
  const rows = store.listSessions(limit).map((r) => ({
    sessionId: r.id, root: r.root, title: r.title, mode: r.mode,
    style: r.style, model: r.model, status: r.status,
    createdAt: r.created_at, updatedAt: r.updated_at,
    /* Said plainly, because it is the one thing a person needs to know before
       reopening: this session did not finish, and nobody stopped it. */
    interrupted: r.status === SessionStatus.INTERRUPTED,
  }));
  send(notify(Notify.SESSION_LIST, { sessions: rows, available: true }, { id }));
}

/**
 * Reopen a session that is on disk.
 *
 * Two things come back and they are different in kind. The transcript is
 * RESTORED: the stored events are replayed to the interface, which folds them
 * with the same reducer it used live, so what the person sees is what
 * happened. The model's context is SUMMARISED: the provider messages were
 * never persisted, and rebuilding them from events would be a plausible
 * reconstruction rather than the thing itself. Summarising is honest about
 * that — the model is told it is reading a summary of earlier work — and it
 * reuses the machinery compaction already needs.
 *
 * Nothing here executes. Replay folds events into state; it never calls a
 * tool, so reopening a session cannot repeat what the session did.
 */
function sessionResume(id, payload) {
  if (!provider || !provider.provider) {
    return fail(id, ErrorCode.PROVIDER,
      "Connect to a model before reopening a session.");
  }
  if (!store) {
    return fail(id, ErrorCode.INTERNAL,
      "Session history could not be opened on this machine, so nothing can be reopened.");
  }
  const wanted = String(payload.sessionId ?? "");
  const row = store.getSession(wanted);
  if (!row) return fail(id, ErrorCode.NO_SUCH_SESSION, "That session is not on disk.");
  if (sessions.has(wanted)) {
    return fail(id, ErrorCode.BUSY, "That session is already open.");
  }

  /** @type {string|null} */
  let root = null;
  if (row.root) {
    try {
      root = canonicalRoot(String(row.root));
    } catch (/** @type {any} */ e) {
      return fail(id, ErrorCode.BAD_ARGUMENT,
        `That session's project folder is no longer there: ${row.root}`);
    }
  }

  const events = store.readEvents(wanted, { inflate: false });

  /* The objective is the first thing the person asked for, which is what a
     summary has to keep or the agent finishes a different task. */
  const firstUser = events.find((e) => e.type === "user_message_created");
  const objective = firstUser ? String(firstUser.payload?.text ?? "") : "";
  const summary = events.length
    ? renderSummary(summarise(events, { objective }))
    : null;

  const state = build(provider.provider, wanted, root, normalizeMode(row.mode), { summary, objective });
  store.setStatus(wanted, SessionStatus.RUNNING);

  send(notify(Notify.SESSION_CREATED, {
    sessionId: wanted, root, mode: state.mode, model: provider.info.model,
    resumed: true, wasInterrupted: row.status === SessionStatus.INTERRUPTED,
    events: events.length,
  }, { id, sessionId: wanted }));

  /* The transcript, as it happened. Sent after session.created so the
     interface has somewhere to put it, and marked replayed so it cannot be
     mistaken for a run that is happening now. */
  for (const ev of events) {
    send(notify(Notify.AGENT_EVENT, { ...ev, replayed: true }, { sessionId: wanted }));
  }
  send(notify(Notify.SESSION_REPLAYED, {
    sessionId: wanted, events: events.length,
    status: row.status,
    summarised: !!summary,
  }, { id, sessionId: wanted }));
}

/**
 * Give an open conversation a project folder.
 *
 * This exists because of a bug worth stating plainly. The prompt tells a model
 * with no folder to say so and ask the person to open one — and opening one
 * used to mean session.create, which is a *new* session. The transcript that
 * had just explained why a folder was needed disappeared at the moment the
 * person acted on it. Answering "open a folder" with a blank screen is worse
 * than never offering the folder.
 *
 * So the session keeps its identity, its event log, its messages and its plan,
 * and gains a root. The stored row is updated rather than replaced, because it
 * is one conversation that gained a folder partway through; recording it as
 * two would lose the half that explains the other.
 *
 * Tools arrive with the folder, through the same allowedGroups that refuses
 * them without one — so this is also the moment a conversation stops being
 * only a conversation, and it says so.
 */
async function sessionSetRoot(id, sessionId, payload) {
  const s = sessions.get(sessionId);
  if (!s) return fail(id, ErrorCode.NO_SUCH_SESSION, "That session is not open.");
  if (s.running) {
    /* Mid-turn the model is already reasoning from a prompt that says there is
       no folder, and tools would appear underneath it between one tool call
       and the next. */
    return fail(id, ErrorCode.BUSY,
      "Finish or stop the current turn before opening a project folder.");
  }

  /** @type {string|null} */
  let root = null;
  if (payload.root) {
    try {
      root = canonicalRoot(String(payload.root));
    } catch (/** @type {any} */ e) {
      return fail(id, ErrorCode.BAD_ARGUMENT,
        e instanceof PathEscape ? e.message : "That project folder could not be opened.");
    }
  }

  s.root = root;
  /* The same place session.create puts them: inside the project, because a
     checkpoint of a file belongs beside the file it can restore. */
  s.agent.setRoot(root, {
    snapshotDir: root ? join(root, ".forgelocal", "snapshots") : undefined,
  });

  const profile = profiles && provider
    ? profiles.get(provider.info.baseUrl, provider.info.model)
    : null;
  s.groups = s.agent.setGroups(allowedGroups(DEFAULT_GROUPS, profile, root));

  /* The row follows the session rather than the other way round. A store that
     cannot be written is not a reason to refuse the folder — the person would
     lose the conversation to protect a record of it. */
  try { store.setRoot(sessionId, root ?? ""); } catch (/** @type {any} */ e) {
    log(`[sidecar] the session row could not be updated: ${e && e.message}`);
  }

  send(notify(Notify.SESSION_ROOT, {
    sessionId, root, canAct: !!root, groups: s.groups,
  }, { id, sessionId }));
}

async function sessionDispose(id, sessionId) {
  const s = sessions.get(sessionId);
  // Remove it first, so a dispose that is slow to release a browser cannot be
  // raced by a turn on a session that is already going away.
  sessions.delete(sessionId);
  if (s) {
    /* dispose(), not stop(). stop() only aborts the turn; it leaves the
       isolated browser running, which means its cookies and storage outlive
       the session that created them — exactly what the isolation is for. */
    try { await s.agent.dispose(); } catch { /* already gone */ }
  }
  /* Closed, not deleted. The transcript is the point of storing it, and a
     person closing a tab has not asked to lose the record of what happened. */
  if (store && s) {
    try { store.closeSession(sessionId, SessionStatus.COMPLETED); }
    catch (/** @type {any} */ e) { log(`could not close the session row: ${e && e.message}`); }
  }
  send(notify(Notify.TURN_COMPLETED, { disposed: true }, { id, sessionId }));
}

/** Every path that ends a turn funnels through here, so none can be forgotten. */
function settle(id, s, outcome) {
  s.running = false;
  if (outcome.stop === StopReason.AWAITING_PERMISSION) return; // the card was already sent
  if (outcome.stop === StopReason.AWAITING_ANSWER) {
    send(notify(Notify.QUESTION_REQUESTED, {
      questions: outcome.detail?.questions ?? [],
    }, { id, sessionId: s.id }));
    return;
  }
  send(notify(Notify.TURN_COMPLETED, {
    stop: outcome.stop, turnId: outcome.turnId, detail: outcome.detail ?? null,
  }, { id, sessionId: s.id }));
}

/**
 * Run the conformance suite against the connected model.
 *
 * Deliberately explicit, never automatic. It sends ten real prompts and costs
 * a minute or two of the user's hardware, so it happens when a person asks for
 * it and not as a side effect of choosing a model. Nothing it does touches the
 * project: the tools are stubbed inside runConformance and their results are
 * fixed strings, which is what makes it safe to run against a model nobody
 * trusts yet.
 */
async function modelTest(id, payload) {
  if (!provider || !provider.provider) {
    return fail(id, ErrorCode.PROVIDER, "Connect to a model before testing it.");
  }
  if (testing) {
    return fail(id, ErrorCode.BUSY, "A conformance run is already in progress.");
  }
  const { baseUrl, model } = provider.info;
  const p = provider.provider;
  const controller = new AbortController();
  testing = controller;

  let done = 0;
  try {
    const out = await runConformance({
      provider: p, model, baseUrl,
      capabilities: payload.capabilities ?? {},
      signal: controller.signal,
      log: (line) => {
        done += 1;
        send(notify(Notify.MODEL_TEST_PROGRESS, {
          model, done, total: 10, line,
        }, { id }));
      },
    });

    /* Stored before it is reported, so a crash between the two costs a
       notification rather than the whole run. */
    if (profiles) {
      try { profiles.set(baseUrl, model, out.profile); }
      catch (/** @type {any} */ e) { log(`could not store the profile: ${e && e.message}`); }
    }

    send(notify(Notify.MODEL_TESTED, {
      model, baseUrl,
      profile: out.profile,
      results: out.results,
      reason: out.reason,
      total: out.total,
      agentReady: agentAllowed(out.profile),
    }, { id }));
  } catch (/** @type {any} */ e) {
    /* A run that did not finish grades nothing. Writing a partial verdict
       would be worse than none: an interrupted suite that happened to pass its
       first four cases would read as a model that passed four cases. */
    send(notify(Notify.MODEL_TESTED, {
      model, baseUrl,
      profile: emptyProfile({ model, baseUrl, agentGrade: AgentGrade.UNTESTED }),
      results: [], agentReady: false,
      reason: controller.signal.aborted
        ? "The run was stopped, so this model is still untested."
        : `The run could not finish: ${e && e.message ? e.message : e}. This model is still untested.`,
    }, { id }));
  } finally {
    testing = null;
  }
}

function modelTestCancel(id) {
  if (!testing) {
    return send(notify(Notify.MODEL_TESTED, {
      profile: null, agentReady: false, reason: "No conformance run was in progress.",
    }, { id }));
  }
  testing.abort();
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
  // The composer's Quick / Standard / Thorough control, as a turn budget.
  if (payload.effort) {
    s.effort = s.agent.setEffort(payload.effort);
  }
  /* Output style. Carried on the turn rather than as a request of its own,
     because it takes effect at the next turn and nowhere else: sending it
     separately would create a window in which the setting the person can see
     and the one the model was given disagree. */
  if (payload.style) {
    s.style = s.agent.setStyle(payload.style);
  }
  /* Which tool groups this turn may use, for the same reason — and filtered
     through allowedGroups, because the request comes from the renderer and a
     request is not a grant. What the session actually got is reported back so
     the interface can show a toggle that was asked for and refused rather
     than leaving it looking enabled. */
  if (Array.isArray(payload.groups)) {
    const profile = profiles && provider
      ? profiles.get(provider.info.baseUrl, provider.info.model)
      : null;
    s.groups = s.agent.setGroups(allowedGroups(payload.groups, profile, s.root));
    const denied = payload.groups.filter((g) => !s.groups.includes(g));
    if (denied.length) {
      send(notify(Notify.SESSION_TOOLS, {
        groups: s.groups, denied,
        reason: "Browsing is only offered for a model the conformance suite has graded.",
      }, { id, sessionId }));
    }
  }
  s.running = true;
  try {
    settle(id, s, await s.agent.send(text));
  } catch (/** @type {any} */ e) {
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
  } catch (/** @type {any} */ e) {
    s.running = false;
    fail(id, ErrorCode.BAD_ARGUMENT, e && e.message ? e.message : "That decision could not be applied.", sessionId);
  }
}

/**
 * Resume a paused turn with the user's answer.
 *
 * The answer may be chosen options, free text, or both — someone can pick
 * "localStorage" and add "but namespace the key". An empty payload is
 * refused rather than resumed, because resuming with nothing hands the model
 * a turn in which it asked a question and got silence, and it will usually
 * answer the question itself.
 */

/** The closed set of controls the browser panel may press. */
const BROWSER_ACTIONS = new Set(["back", "forward", "reload", "close", "viewport", "refresh"]);

/**
 * Act on a control the person pressed in the browser panel.
 *
 * The list above is the whole surface, checked here rather than only in the
 * orchestrator: the renderer is not a trusted source of action names, and a
 * request type that forwarded whatever string it was given would be one
 * refactor away from being a general driver.
 *
 * Success needs no reply of its own. The session emits browser_navigated,
 * browser_viewport, browser_preview or browser_session_closed, and those
 * already reach the panel as agent events — which means what the panel draws
 * is what the browser actually did, not what the button claimed it would.
 */
async function browserControl(id, sessionId, payload) {
  const s = sessions.get(sessionId);
  if (!s) return fail(id, ErrorCode.NO_SUCH_SESSION, "That session is gone.", sessionId);

  const action = String(payload.action ?? "");
  if (!BROWSER_ACTIONS.has(action)) {
    return send(notify(Notify.BROWSER_CONTROLLED, {
      ok: false, action, error: `${action || "That"} is not a browser control.`,
    }, { id, sessionId }));
  }

  try {
    const r = await s.agent.browserControl(action, {
      width: payload.width, height: payload.height,
    });
    send(notify(Notify.BROWSER_CONTROLLED, { action, ...r }, { id, sessionId }));
  } catch (/** @type {any} */ e) {
    send(notify(Notify.BROWSER_CONTROLLED, {
      ok: false, action, error: e && e.message ? e.message : "The browser did not respond.",
    }, { id, sessionId }));
  }
}

async function questionAnswer(id, sessionId, payload) {
  const s = sessions.get(sessionId);
  if (!s) return fail(id, ErrorCode.NO_SUCH_SESSION, "That session is gone.", sessionId);

  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  const answers = Array.isArray(payload.answers) ? payload.answers : [];
  const chose = answers.some((a) => {
    const c = a && a.choice;
    return Array.isArray(c) ? c.length > 0 : typeof c === "string" && c.trim() !== "";
  });
  if (!text && !chose) {
    return fail(id, ErrorCode.BAD_ARGUMENT,
      "An empty answer cannot resume the turn.", sessionId);
  }

  s.running = true;
  try {
    settle(id, s, await s.agent.answer({ answers, text }));
  } catch (/** @type {any} */ e) {
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

/** How long a shutdown will wait for browsers to close before exiting anyway. */
const SHUTDOWN_GRACE_MS = 2000;
let shuttingDown = false;

/**
 * Losing the host means losing the reason to exist; every child goes too.
 *
 * Asynchronous now, because a session can be holding a browser and the exit
 * path is the last chance to close it properly — a hard process.exit() leaves
 * the profile directory behind and relies on Playwright's own exit handler to
 * kill the browser, which is not a promise this code should be making on its
 * behalf. Bounded, because a browser that will not close must not be able to
 * keep the sidecar alive after the host has gone.
 *
 * @param {number} code
 */
async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  const all = [...sessions.values()];
  sessions.clear();
  const grace = new Promise((r) => { setTimeout(r, SHUTDOWN_GRACE_MS).unref(); });
  await Promise.race([
    Promise.allSettled(all.map((s) => s.agent.dispose())),
    grace,
  ]);
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
