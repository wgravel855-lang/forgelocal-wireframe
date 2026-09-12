// @ts-check
/**
 * The agent loop.
 *
 * This is a service, not a chain of UI callbacks: it takes a provider, a tool
 * registry and a permission policy, and it emits the normalized event stream.
 * Nothing in it touches a DOM, which is what lets an integration test drive the
 * identical code path the desktop app would.
 *
 * The loop is:
 *
 *   build context -> stream a turn -> collect text and tool calls
 *     -> validate each call against its schema
 *     -> ask the permission policy
 *     -> suspend for the user, or execute
 *     -> append the result -> go again
 *
 * It stops for exactly four reasons: the model gave a final answer, the user
 * interrupted, a limit was reached, or something failed unrecoverably. It never
 * stops merely because a tool finished, and it never turns an error into a
 * cheerful assistant message.
 */

import { randomUUID } from "node:crypto";
import { EventType, SessionState, Phase, createEmitter } from "./events.mjs";
import {
  TOOLS, validateCall, toolSpecs, toolSummaries, DEFAULT_GROUPS,
} from "./tools/index.mjs";
import { decide, grantForSession, Decision, normalizeMode } from "./permissions.mjs";
import { composePrompt, normalizeStyle, OutputStyle } from "./prompt.mjs";
import { compact as compactContext } from "./compact.mjs";
import { ModelEvent, ProviderFailure, estimateTokens } from "./providers/types.mjs";
import {
  loadInstructions, createLedger, recordInLedger,
  ledgerSummary, contextUsage, isStale,
} from "./context.mjs";

/** Limits. Every one of them exists because the alternative is an agent that
 *  spends the user's evening in a loop. */
/**
 * How many tool-calling turns each effort setting is allowed.
 *
 * The composer has had a Quick / Standard / Thorough control since the first
 * pass and it only ever set its own label. This is what makes it mean
 * something: the budget is how much reading and re-checking the loop can
 * afford before it has to answer, which is exactly what the menu's own
 * descriptions promise.
 */
export const EFFORT_TURNS = Object.freeze({
  quick: 10,
  standard: 24,
  thorough: 40,
});

/** @param {unknown} v @returns {keyof typeof EFFORT_TURNS} */
export function normalizeEffort(v) {
  const k = String(v ?? "").toLowerCase();
  return k === "quick" || k === "thorough" ? k : "standard";
}

export const LIMITS = Object.freeze({
  MAX_TURNS: 24,
  MAX_MALFORMED_REPAIRS: 2,
  MAX_IDENTICAL_CALLS: 3,
  MAX_WALL_MS: 10 * 60 * 1000,
});

export const StopReason = Object.freeze({
  FINAL: "final",
  CANCELLED: "cancelled",
  TURN_LIMIT: "turn_limit",
  TIME_LIMIT: "time_limit",
  REPEATED_CALLS: "repeated_calls",
  MALFORMED_LIMIT: "malformed_limit",
  AWAITING_PERMISSION: "awaiting_permission",
  AWAITING_ANSWER: "awaiting_answer",
  PROVIDER_ERROR: "provider_error",
  RUNTIME_ERROR: "runtime_error",
});

/**
 * @param {object} opts
 * @param {string} opts.root                canonical project root
 * @param {any} opts.provider
 * @param {string} [opts.mode]
 * @param {string} [opts.sessionId]
 * @param {(event: any) => void} opts.onEvent
 * @param {{snapshotDir?: string}} [opts.paths]
 * @param {typeof LIMITS} [opts.limits]
 * @param {() => number} [opts.now]
 */
export function createOrchestrator({
  root, provider, mode = "manual", sessionId = randomUUID(),
  onEvent, paths = {}, limits: limitsIn = LIMITS, now = () => Date.now(),
  style = OutputStyle.ADAPTIVE, capabilities = null, skills = [],
  groups = DEFAULT_GROUPS,
}) {
  let limits = limitsIn;
  // Reassigned by setEffort, which is why neither of these is a const.
  let effortName = "standard";
  const emitter = createEmitter(sessionId);
  const emit = (type, payload, meta) => {
    const ev = emitter.emit(type, payload, meta);
    history.push(ev);
    onEvent(ev);
    return ev;
  };

  const instructions = loadInstructions(root);
  const ledger = createLedger();
  const grants = new Set();
  const ctx = { root, snapshotDir: paths.snapshotDir, plan: null };
  let currentMode = normalizeMode(mode);
  let currentStyle = normalizeStyle(style);
  /** The compacted summary of everything trimmed out of `messages`, or null. */
  let compacted = null;
  /** Fraction the last compaction freed. Two poor results in a row is thrashing. */
  let lastFreed = 1;
  /** The first thing the user asked for, which is the objective a summary keeps. */
  let firstRequest = "";
  /** Every event this session emitted, which is what compaction summarises from. */
  const history = [];

  /** provider-neutral message list; the working context, not the transcript */
  /** @type {any[]} */
  let messages = [];
  /** @type {AbortController|null} */
  let abort = null;
  /** set while a turn is suspended waiting on the user */
  let pending = null;
  let lastUsage = null;
  /* Reliability counters belong to the user's request, not to one entry into
     the loop. Keeping them inside runLoop meant every permission prompt handed
     the model a clean slate, so an agent that looped while occasionally asking
     for approval was never caught. They reset in send(). */
  let malformed = 0;
  /** signature -> count, since the last time something actually changed */
  let seenCalls = new Map();
  let progressAt = 0;
  /** set once this turn has changed something, so later reads read as checks */
  let wrote = false;

  const started = () => {
    emit(EventType.SESSION_STARTED, {
      cwd: root, mode: currentMode, model: provider.model ?? null,
      instructions: instructions ? instructions.path : null,
    });
  };

  /** The last phase emitted, so a repeat is not a second event. */
  let currentPhase = Phase.IDLE;

  /**
   * Move the visible phase.
   *
   * The phase is emitted rather than inferred because the interface cannot
   * tell the difference between reading four files to understand a request
   * and reading one to check an edit landed, and those are Exploring and
   * Verifying. Only this function knows which, because only the loop knows
   * whether anything has been written yet.
   *
   * @param {string} next @param {string} [turnId]
   */
  const setPhase = (next, turnId) => {
    if (next === currentPhase) return;
    currentPhase = next;
    emit(EventType.PHASE_CHANGED, { phase: next }, { turnId });
  };

  const setState = (state, turnId) =>
    emit(EventType.SESSION_STATE_CHANGED, { state }, { turnId });

  const status = (text, turnId) =>
    emit(EventType.STATUS_CHANGED, { status: text }, { turnId });

  /** Rebuild the working context. The ledger is a system note, not a message. */
  function buildMessages() {
    const head = [{
      role: "system",
      content: composePrompt({
        root,
        mode: currentMode,
        style: currentStyle,
        capabilities,
        tools: toolSummaries(groups),
        instructions,
        skills,
        summary: compacted,
      }),
    }];
    const summary = ledgerSummary(ledger);
    if (summary) {
      head.push({ role: "system", content: `Where you are so far:\n${summary}` });
    }
    if (ctx.plan) {
      head.push({
        role: "system",
        content: `Current plan:\n${ctx.plan.map((s, i) => `${i + 1}. [${s.status}] ${s.step}`).join("\n")}`,
      });
    }
    return [...head, ...messages];
  }

  function reportContext(turnId) {
    const usage = contextUsage(buildMessages(), provider.capabilities?.().contextWindow ?? null, lastUsage);
    emit(EventType.CONTEXT_USAGE_UPDATED, {
      used_tokens: usage.used,
      context_window: usage.window,
      estimated: usage.estimated,
    }, { turnId });
    return usage;
  }

  /**
   * Run one user message to completion.
   * @param {string} text
   * @returns {Promise<{stop: string, turnId: string, detail?: any}>}
   */
  async function send(text) {
    if (pending) {
      return { stop: pending.kind, turnId: pending.turnId, detail: pending.detail };
    }
    const turnId = randomUUID();
    abort = new AbortController();
    const deadline = now() + limits.MAX_WALL_MS;
    malformed = 0;
    seenCalls = new Map();
    progressAt = ledger.changed.size;

    emit(EventType.TURN_STARTED, { turn_id: turnId }, { turnId });
    setPhase(Phase.UNDERSTANDING, turnId);
    wrote = false;
    emit(EventType.USER_MESSAGE_CREATED, { message_id: randomUUID(), text }, { turnId });
    messages.push({ role: "user", content: text });
    if (!firstRequest) firstRequest = text;

    // A checkpoint per user prompt, which is what makes "undo that request"
    // meaningful later. It records the point, not the file bytes; those are
    // snapshotted by apply_patch immediately before it writes.
    emit(EventType.CHECKPOINT_CREATED, {
      checkpoint_id: `ck_${Date.now().toString(36)}`,
      label: text.slice(0, 60), files: ledger.changed.size,
    }, { turnId });

    return runLoop(turnId, deadline);
  }

  /**
   * @param {string} turnId @param {number} deadline
   */
  async function runLoop(turnId, deadline) {
    /* Repetition only matters when nothing is changing. Re-running a test after
       an edit is the loop working; re-running it four times with the same result
       and no edit between is the model stuck. So the counters (declared at the
       session level above, and reset per user request) clear whenever a file
       actually changes, which makes this no-progress detection rather than a cap
       on how often a command may ever be run. */

    for (let turn = 0; turn < limits.MAX_TURNS; turn++) {
      /* Before asking the model anything, check the context will fit. This
         runs per turn rather than per request because a single turn can add
         twenty tool results, and discovering the overflow from the server's
         error is both slower and less recoverable. */
      const fit = compactContext({
        messages,
        events: history,
        window: provider.capabilities?.().contextWindow ?? null,
        headTokens: estimateTokens(buildMessages()[0]?.content ?? ""),
        previousFreed: lastFreed,
        objective: firstRequest,
        plan: ctx.plan ?? [],
      });
      if (fit.needed && fit.thrashing) {
        emit(EventType.RUNTIME_ERROR, {
          code: "CONTEXT_EXHAUSTED", message: fit.reason,
        }, { turnId });
        return finish(turnId, StopReason.ERROR, { message: fit.reason });
      }

      /* A compaction that could not help is not a boundary.

         The first version of this fell through to the emit below, which put
         a divider in the transcript for a rewrite that never happened AND
         assigned messages = fit.messages, which is undefined for a noop. It
         would have wiped the working context on the turn after a session got
         close to its window. It records the failed attempt for the thrash
         detector and changes nothing else. */
      if (fit.needed && fit.noop) {
        lastFreed = 0;
      } else if (fit.needed) {
        setPhase(Phase.COMPACTING, turnId);
        emit(EventType.COMPACTION_STARTED, {
          before_tokens: fit.before, dropped: fit.dropped ?? 0,
        }, { turnId });
        messages = fit.messages;
        if (fit.summaryText) compacted = fit.summaryText;
        lastFreed = fit.freed;
        emit(EventType.COMPACTION_COMPLETED, {
          after_tokens: fit.after, freed: fit.freed, summary: compacted ?? null,
        }, { turnId });
      }

      if (abort?.signal.aborted) return finish(turnId, StopReason.CANCELLED);
      if (now() > deadline) return finish(turnId, StopReason.TIME_LIMIT);

      setState(SessionState.THINKING, turnId);
      status("Thinking", turnId);

      const messageId = randomUUID();
      let textOpen = false;
      let assistantText = "";
      /** id -> {name, args} */
      const calls = new Map();
      let order = [];
      let finishReason = null;
      let providerError = null;

      try {
        const stream = provider.streamTurn(
          { messages: buildMessages(), tools: toolSpecs(groups) },
          { signal: abort?.signal },
        );
        for await (const ev of stream) {
          switch (ev.type) {
            case ModelEvent.TEXT_DELTA:
              if (!textOpen) {
                textOpen = true;
                emit(EventType.ASSISTANT_TEXT_STARTED, { message_id: messageId }, { turnId });
                setState(SessionState.STREAMING, turnId);
              }
              assistantText += ev.text;
              emit(EventType.ASSISTANT_TEXT_DELTA, { message_id: messageId, text: ev.text }, { turnId });
              break;

            case ModelEvent.REASONING_DELTA:
              // Summary only, and only as a status line. It is never added to
              // the transcript as assistant text.
              status("Working through it", turnId);
              break;

            case ModelEvent.TOOL_CALL_START:
              calls.set(ev.id, { name: ev.name, raw: "" });
              order.push(ev.id);
              break;

            case ModelEvent.TOOL_CALL_DELTA: {
              const c = calls.get(ev.id);
              if (c) c.raw += ev.text;
              break;
            }

            case ModelEvent.TOOL_CALL_END:
              break;

            case ModelEvent.USAGE:
              lastUsage = ev;
              break;

            case ModelEvent.FINISH:
              finishReason = ev.reason;
              break;

            case ModelEvent.ERROR:
              providerError = ev;
              break;

            default:
              break;
          }
        }
      } catch (e) {
        if (e instanceof ProviderFailure && e.kind === "cancelled") {
          return finish(turnId, StopReason.CANCELLED);
        }
        emit(EventType.RUNTIME_ERROR, {
          message: e && e.message ? e.message : "The model provider failed.",
          code: e instanceof ProviderFailure ? e.kind : "provider",
        }, { turnId });
        return finish(turnId, StopReason.PROVIDER_ERROR, { message: e && e.message });
      }

      if (textOpen) {
        emit(EventType.ASSISTANT_TEXT_COMPLETED, { message_id: messageId, text: assistantText }, { turnId });
      }
      if (providerError) {
        emit(EventType.RUNTIME_ERROR, {
          message: providerError.message, code: providerError.kind,
        }, { turnId });
        return finish(turnId, StopReason.PROVIDER_ERROR, providerError);
      }
      if (abort?.signal.aborted || finishReason === "cancelled") {
        return finish(turnId, StopReason.CANCELLED);
      }

      reportContext(turnId);

      // No tool calls: the model is done talking.
      if (!order.length) {
        if (assistantText) messages.push({ role: "assistant", content: assistantText });
        return finish(turnId, StopReason.FINAL);
      }

      // The assistant turn that requested the calls has to go into the context
      // in the shape the provider expects to see it echoed back.
      messages.push({
        role: "assistant",
        content: assistantText || null,
        tool_calls: order.map((id) => ({
          id, type: "function",
          function: { name: calls.get(id).name, arguments: calls.get(id).raw || "{}" },
        })),
      });

      let repaired = false;

      for (const id of order) {
        const call = calls.get(id);
        emit(EventType.TOOL_CALL_REQUESTED, {
          tool_call_id: id, tool: call.name, args: safeParse(call.raw).value ?? {},
        }, { turnId });

        // ---- parse ----------------------------------------------------
        const parsed = safeParse(call.raw);
        if (!parsed.ok) {
          malformed++;
          const msg = `The arguments were not valid JSON: ${parsed.error}. Send the arguments again as a single JSON object.`;
          emit(EventType.TOOL_FAILED, { tool_call_id: id, error: msg, code: "BAD_JSON" }, { turnId });
          pushToolResult(id, { error: msg });
          repaired = true;
          if (malformed > limits.MAX_MALFORMED_REPAIRS) {
            return finish(turnId, StopReason.MALFORMED_LIMIT, { tool: call.name });
          }
          continue;
        }

        // ---- schema ---------------------------------------------------
        const check = validateCall(call.name, parsed.value, groups);
        if (!check.ok) {
          malformed++;
          const msg = `Those arguments do not match the tool: ${check.errors.join("; ")}`;
          emit(EventType.TOOL_FAILED, { tool_call_id: id, error: msg, code: "SCHEMA_INVALID" }, { turnId });
          pushToolResult(id, { error: msg });
          repaired = true;
          if (malformed > limits.MAX_MALFORMED_REPAIRS) {
            return finish(turnId, StopReason.MALFORMED_LIMIT, { tool: call.name });
          }
          continue;
        }

        // ---- repetition without progress ------------------------------
        if (ledger.changed.size !== progressAt) {
          progressAt = ledger.changed.size;
          seenCalls.clear();
        }
        const sig = `${call.name}:${stable(parsed.value)}`;
        const count = (seenCalls.get(sig) ?? 0) + 1;
        seenCalls.set(sig, count);
        if (count > limits.MAX_IDENTICAL_CALLS) {
          emit(EventType.RUNTIME_ERROR, {
            message: `The model called ${call.name} with the same arguments ${count} times `
              + "without changing anything in between.",
            code: "REPEATED_CALL",
          }, { turnId });
          return finish(turnId, StopReason.REPEATED_CALLS, { tool: call.name });
        }

        // ---- permission -----------------------------------------------
        const verdict = decide({
          mode: currentMode, tool: call.name, args: parsed.value, sessionGrants: grants,
        });
        if (verdict.decision === Decision.DENY) {
          emit(EventType.TOOL_FAILED, {
            tool_call_id: id, error: verdict.reason, code: "DENIED",
          }, { turnId });
          pushToolResult(id, { error: `Not allowed: ${verdict.reason}` });
          continue;
        }
        if (verdict.decision === Decision.ASK) {
          const requestId = randomUUID();
          emit(EventType.PERMISSION_REQUIRED, {
            request_id: requestId, tool_call_id: id, tool: call.name,
            args: parsed.value, reason: verdict.reason,
            mode: currentMode, options: verdict.options ?? [],
          }, { turnId });
          setState(SessionState.AWAITING_PERMISSION, turnId);
          status("Waiting for approval", turnId);
          // The turn genuinely suspends here. Resuming re-enters this loop with
          // the decision applied, rather than executing behind the user's back.
          pending = {
            kind: StopReason.AWAITING_PERMISSION, turnId, deadline,
            requestId, callId: id, tool: call.name, args: parsed.value,
            remaining: order.slice(order.indexOf(id) + 1).map((x) => ({ id: x, ...calls.get(x) })),
            detail: { tool: call.name, reason: verdict.reason },
          };
          return { stop: StopReason.AWAITING_PERMISSION, turnId, detail: pending.detail };
        }

        // ---- execute --------------------------------------------------
        const outcome = await execute(id, call.name, parsed.value, turnId);
        if (outcome.suspended) {
          return { stop: outcome.stop, turnId, detail: outcome.detail };
        }
      }

      if (repaired) continue; // let the model fix its call
    }

    return finish(turnId, StopReason.TURN_LIMIT);
  }

  /**
   * Run one approved tool call and append its result.
   * @param {string} id @param {string} name @param {any} args @param {string} turnId
   */
  async function execute(id, name, args, turnId) {
    const tool = TOOLS[name];
    emit(EventType.TOOL_STARTED, { tool_call_id: id, tool: name }, { turnId });
    setState(SessionState.RUNNING_TOOL, turnId);
    setPhase(phaseFor(name, wrote), turnId);
    status(describe(name, args), turnId);

    // A patch against a file the model has not re-read since changing it is
    // refused here rather than at the filesystem, so the message the model gets
    // says what to do about it.
    if (name === "apply_patch") {
      for (const edit of args.edits ?? []) {
        if (edit.expected_hash) continue;
        const seen = ledger.read.get(edit.path);
        if (!seen) continue;
        const current = currentHash(edit.path);
        if (current && isStale(ledger, edit.path, current)) {
          const msg = `${edit.path} changed since you read it. Read it again before patching.`;
          emit(EventType.TOOL_FAILED, { tool_call_id: id, error: msg, code: "STALE" }, { turnId });
          pushToolResult(id, { error: msg });
          return { suspended: false };
        }
      }
    }

    const startedAt = now();
    try {
      const result = await tool.run(ctx, args, {
        signal: abort?.signal,
        onOutput: tool.streams
          ? (chunkText) => emit(EventType.TOOL_OUTPUT_DELTA, {
              tool_call_id: id, chunk: chunkText,
            }, { turnId })
          : undefined,
      });

      if (name === "update_plan" && result.ok) {
        emit(EventType.PLAN_UPDATED, { items: result.steps }, { turnId });
      }
      if (name === "apply_patch") {
        for (const f of result.files ?? []) {
          emit(EventType.FILE_CHANGED, {
            path: f.path, change: f.change, added: f.added, removed: f.removed,
          }, { turnId, parentToolCallId: id });
        }
        if (result.snapshot_id) {
          emit(EventType.CHECKPOINT_CREATED, {
            checkpoint_id: result.snapshot_id, label: args.description ?? null,
            files: (result.files ?? []).length,
          }, { turnId });
        }
      }

      recordInLedger(ledger, name, args, result);
      emit(EventType.TOOL_COMPLETED, {
        tool_call_id: id, result: summarize(name, result),
        duration_ms: now() - startedAt,
        truncated: !!result.truncated,
      }, { turnId });
      if (name === "apply_patch") wrote = true;
      pushToolResult(id, result);

      // ask_user is the one tool whose success stops the loop.
      if (name === "ask_user") {
        setState(SessionState.AWAITING_PERMISSION, turnId);
        setPhase(Phase.AWAITING_USER, turnId);
        /* The notify drives the card; this drives the transcript row, so a
           replayed session shows the question that was asked and what was
           answered rather than a gap where a pause used to be. */
        emit(EventType.QUESTION_REQUESTED, {
          call_id: id, questions: result.questions,
        }, { turnId });
        status("Waiting for an answer", turnId);
        pending = {
          kind: StopReason.AWAITING_ANSWER, turnId, callId: id,
          questions: result.questions,
          detail: { questions: result.questions },
        };
        return { suspended: true, stop: StopReason.AWAITING_ANSWER, detail: pending.detail };
      }
      return { suspended: false };
    } catch (e) {
      // A tool that throws is a fact the model needs, not a crash. It is
      // reported as a failed call and the loop continues so the model can
      // react, which is the difference between an agent and a script.
      const message = e && e.message ? e.message : "The tool failed.";
      const code = (e && e.code) || "TOOL_ERROR";
      emit(EventType.TOOL_FAILED, {
        tool_call_id: id, error: message, code,
        duration_ms: now() - startedAt,
      }, { turnId });
      pushToolResult(id, { error: message, code, rejected: e && e.rejected });
      return { suspended: false };
    }
  }

  /** @param {string} id @param {any} result */
  function pushToolResult(id, result) {
    messages.push({
      role: "tool",
      tool_call_id: id,
      content: typeof result === "string" ? result : JSON.stringify(result),
    });
  }

  /** @param {string} path */
  function currentHash(path) {
    try {
      // Reading through the tool keeps one definition of "the hash of a file".
      const r = TOOLS.read_file.run(ctx, { path });
      return r.content_hash ?? null;
    } catch { return null; }
  }

  function finish(turnId, stop, detail) {
    if (stop === StopReason.CANCELLED) {
      emit(EventType.TURN_CANCELLED, { reason: "user" }, { turnId });
    } else {
      emit(EventType.TURN_COMPLETED, { stop_reason: stop, ...(detail ? { detail } : {}) }, { turnId });
    }
    abort = null;
    return { stop, turnId, detail };
  }

  return {
    sessionId,
    get mode() { return currentMode; },
    get plan() { return ctx.plan; },
    get ledger() { return ledger; },
    get messages() { return messages; },
    get awaiting() { return pending; },

    start() { started(); },

    setMode(next) {
      currentMode = normalizeMode(next);
      emit(EventType.SESSION_STATE_CHANGED, { state: SessionState.IDLE, mode: currentMode });
      return currentMode;
    },

    /**
     * Set the turn budget for subsequent turns. Only the budget moves: the
     * wall clock, the repair allowance and the repetition guard are safety
     * limits and are not something a menu gets to relax.
     * @param {unknown} next
     */
    setEffort(next) {
      effortName = normalizeEffort(next);
      limits = { ...limits, MAX_TURNS: EFFORT_TURNS[effortName] };
      return effortName;
    },

    get effort() { return effortName; },

    send,

    /** Interrupt the model and any running tool. */
    stop() {
      if (abort) abort.abort();
    },

    /**
     * Answer a permission prompt and continue the turn.
     * @param {string} requestId @param {"approve_once"|"approve_for_session"|"deny"} decision
     */
    async resolvePermission(requestId, decision) {
      if (!pending || pending.kind !== StopReason.AWAITING_PERMISSION) {
        throw new Error("No permission request is waiting.");
      }
      if (pending.requestId !== requestId) {
        throw new Error("That permission request is not the one waiting.");
      }
      const p = pending;
      pending = null;
      emit(EventType.PERMISSION_RESOLVED, {
        request_id: requestId, tool_call_id: p.callId, decision, decided_by: "user",
      }, { turnId: p.turnId });

      if (decision === "deny") {
        pushToolResult(p.callId, { error: "The person declined this action. Do not retry it; find another way or explain what you need." });
      } else {
        if (decision === "approve_for_session") grantForSession(grants, p.tool, p.args);
        const outcome = await execute(p.callId, p.tool, p.args, p.turnId);
        if (outcome.suspended) return { stop: outcome.stop, turnId: p.turnId, detail: outcome.detail };
      }
      return runLoop(p.turnId, p.deadline ?? now() + limits.MAX_WALL_MS);
    },

    /** Answer an ask_user question and continue. */
    /**
     * Answer the pending question and resume the same turn.
     *
     * The answers go back as a user message rather than as a tool result,
     * because that is what they are: the person said something. The tool
     * result for the ask_user call was already pushed when the call ran, so
     * the call/result pairing the provider expects stays intact and the
     * lineage of the turn is unbroken.
     *
     * @param {{answers?: any[], text?: string}|string} input
     */
    async answer(input) {
      if (!pending || pending.kind !== StopReason.AWAITING_ANSWER) {
        throw new Error("No question is waiting.");
      }
      const p = pending;
      pending = null;
      const text = formatAnswers(p.questions ?? [], input);
      messages.push({ role: "user", content: text });
      emit(EventType.QUESTION_ANSWERED, {
        call_id: p.callId,
        answers: typeof input === "string" ? null : (input?.answers ?? null),
        text,
      }, { turnId: p.turnId });
      emit(EventType.USER_MESSAGE_CREATED, { message_id: randomUUID(), text }, { turnId: p.turnId });
      return runLoop(p.turnId, now() + limits.MAX_WALL_MS);
    },
  };
}

/**
 * Turn structured answers back into the sentence the model will read.
 *
 * The model asked in a structure and is answered in prose, deliberately. It
 * has to reason about the answer, and a JSON blob of option ids is worse for
 * that than the words the user actually chose. The question is repeated
 * alongside each answer because by the time the turn resumes it may be many
 * tool results back.
 *
 * A free-text reply that matches no option is passed through as written: the
 * user is never forced into the choices the model imagined.
 *
 * @param {any[]} questions
 * @param {{answers?: any[], text?: string}|string} input
 */
function formatAnswers(questions, input) {
  if (typeof input === "string") return input.trim();

  const answers = Array.isArray(input?.answers) ? input.answers : [];
  const free = typeof input?.text === "string" ? input.text.trim() : "";
  const parts = [];

  for (const q of questions) {
    const found = answers.find((a) => a && a.id === q.id);
    if (!found) continue;
    const chosen = Array.isArray(found.choice) ? found.choice : [found.choice];
    const said = chosen.filter((c) => typeof c === "string" && c.trim()).join(", ");
    if (said) parts.push(`${q.question} ${said}`);
  }

  if (free) parts.push(free);
  return parts.join("\n") || "(no answer given)";
}
/** @param {string} raw */
function safeParse(raw) {
  const text = (raw ?? "").trim();
  if (!text) return { ok: true, value: {} };
  try { return { ok: true, value: JSON.parse(text) }; }
  catch (e) { return { ok: false, error: e.message, value: null }; }
}

/** Stable stringify, so argument order cannot hide a repeated call. */
function stable(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
}

/**
 * Which phase a tool call puts the session into.
 *
 * The same tool means different things at different points in a turn, which
 * is why `wrote` is a parameter rather than something this could look up. A
 * read before anything has changed is exploration; the same read after a
 * patch is the model checking its own work, and an interface that called both
 * "Exploring" would be describing the first half of every turn twice.
 *
 * @param {string} name @param {boolean} wrote
 */
function phaseFor(name, wrote) {
  switch (name) {
    case "update_plan": return Phase.PLANNING;
    case "ask_user": return Phase.AWAITING_USER;
    case "apply_patch": return Phase.ACTING;
    case "run_command": return Phase.VERIFYING;
    default:
      return wrote ? Phase.VERIFYING : Phase.EXPLORING;
  }
}

/** The status line, derived from the action rather than invented. */
function describe(name, args) {
  switch (name) {
    case "read_file": return `Reading ${args.path}`;
    case "list_directory": return `Listing ${args.path || "the project"}`;
    case "glob": return `Finding ${args.pattern}`;
    case "grep": return `Searching for ${String(args.query).slice(0, 40)}`;
    case "apply_patch": return `Updating ${(args.edits ?? []).length} file(s)`;
    case "run_command": return `Running ${(args.argv ?? []).slice(0, 3).join(" ")}`;
    case "update_plan": return "Updating the plan";
    case "ask_user": return "Waiting for an answer";
    default: return "Working";
  }
}

/**
 * What the transcript shows for a completed call. Full output goes to the
 * model; the UI gets the shape it needs for one row.
 */
function summarize(name, r) {
  if (!r || typeof r !== "object") return null;
  switch (name) {
    case "read_file": return { path: r.path, lines: r.total_lines, truncated: r.truncated };
    case "list_directory": return { path: r.path, count: r.count, omitted: r.omitted };
    case "glob": return { count: r.count, truncated: r.truncated };
    case "grep": return { count: r.count, files: r.files_scanned };
    case "apply_patch": return { files: (r.files ?? []).length, added: r.added, removed: r.removed };
    case "run_command":
      return {
        exit_code: r.exit_code, duration_ms: r.duration_ms,
        timed_out: r.timed_out, truncated: r.truncated,
      };
    case "update_plan": return { done: r.done, total: r.total };
    default: return null;
  }
}
