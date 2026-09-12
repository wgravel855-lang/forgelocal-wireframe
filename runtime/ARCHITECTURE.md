# ForgeLocal agent runtime — architecture and decisions

This describes what exists. Anything sequenced for later is named at the bottom
rather than described as if it were here.

## Three processes, and what each is allowed to do

```
  Rust host (Tauri v2 / WebView2)      owns the window, the sidecar's lifetime,
   │                                   and the native dialogs
   │  spawn, stdin/stdout
   ▼
  Node sidecar (runtime/host)          owns sessions, providers, tools, the
   │                                   browser, the filesystem and the database
   │  NDJSON frames over the pipe
   ▼
  WebView renderer (design/)           owns the interface, and nothing else
```

The boundary that matters: **the renderer holds no filesystem, shell or browser
authority.** It renders events and sends requests. It never holds a page handle,
a file descriptor or a child process, so a compromised renderer cannot drive a
browser or read a file — it can only ask, and every ask goes through the
permission policy in the sidecar.

Nothing listens on a socket. The sidecar speaks over stdin and stdout only, so
there is no unauthenticated local port for anything else on the machine to find.

### Why the sidecar is Node rather than Rust

The privileged core is JavaScript, in one process, spoken to over a pipe. The
Rust host owns the window and the sidecar's lifetime and nothing else. That is
a deliberate split and it has a cost: the Rust side is thin enough that the real
trust boundary is the process boundary rather than a language boundary. What it
buys is that the agent loop, the tools, the permission policy and the browser
are one body of code that the integration tests drive directly — the same code
path the app uses, with nothing mocked between the test and the tool.

## The protocol

One JSON object per line, both directions. `JSON.stringify` escapes every
newline inside a string, so a line break can only ever be a frame boundary: the
format frames itself with no length prefix to get out of step with.

Both sides validate. The Rust host checks the frame it forwards and
`host/protocol.mjs` checks it again on arrival, because a transport check is not
an authorization check and neither is a UI one.

Requests are a closed set (`protocol.mjs`): session create/dispose/list/resume,
turn start/cancel, permission resolve, question answer, provider
connect/disconnect, browser control, model test. Anything else is refused by
name.

## Layout

```
runtime/
  core/
    paths.mjs           canonical root, containment, the ignore list
    permissions.mjs     Plan / Manual / Allow edits policy
    danger.mjs          the always-block and always-confirm classifier
    schema.mjs          the strict JSON Schema validator
    secrets.mjs         redaction and the child-process env allowlist
    context.mjs         project instructions, the ledger, context accounting
    prompt.mjs          the nine prompt layers and the output styles
    orchestrator.mjs    the agent loop
    compact.mjs         two-stage context compaction and the session summary
    store.mjs           SQLite session persistence
    profiles.mjs        remembered conformance verdicts
    capability.mjs      the conformance cases and the grading rule
    conformance.mjs     running the suite against a provider
    events.mjs          re-exports the renderer's event contract
    tools/              read, patch, command, plan, web, browser; index.mjs
                        is the registry and the group table
    browser/
      session.mjs       one isolated Playwright context per session
      snapshot.mjs      the in-page walker and the text it renders to
      policy.mjs        the browser permission axis
    providers/          fake (deterministic) and openai-compatible
  host/
    protocol.mjs        the frame contract
    sidecar.mjs         the process: sessions, provider, store, profiles
    fakeserver.mjs      a scripted OpenAI-compatible server, for tests
  conformance.mjs       CLI: run the suite against a real server
  golden.mjs            the end-to-end task, run against a real model
```

## The loop

`orchestrator.mjs` owns it. It is a service with no DOM dependency, so an
integration test drives the identical code path the desktop app does:

1. compact the working context if it is close to the window;
2. build the prompt from its layers;
3. ask the provider for a turn, streaming;
4. normalize deltas into events;
5. parse and validate tool calls against their schemas;
6. evaluate the permission policy — both axes, see below;
7. execute approved tools, or emit `permission_required` and suspend;
8. append a normalized tool result;
9. update plan, ledger, checkpoint and context accounting;
10. call the model again;
11. stop on a final response, a user interrupt, a limit, or an unrecoverable
    error — never because a tool merely finished.

It stops for exactly four reasons and never turns an error into a cheerful
assistant message.

## The prompt, in layers

`prompt.mjs` composes nine: invariants, style, mode, capabilities, tools,
environment, project, skills, summary. They are separate because they change on
different schedules and for different reasons — the mode changes when the user
changes it, the capabilities layer when a conformance run finishes, the summary
when compaction runs.

Style sits **under** the invariants, not over them. "Concise" changes length and
ordering; it cannot change what may be claimed, what needs approval, or what
counts as evidence. `prompt.test.mjs` asserts eight invariants hold across all
twelve mode/style combinations, by meaning rather than by whole-string snapshot:
a whole-string snapshot fails on every wording change, so it gets regenerated
without being read, and the day it is regenerated over a deleted safety line
nobody notices.

## Two permission axes, kept apart

`permissions.mjs` answers *may this session do this kind of thing at all* —
read, write, execute, under Plan / Manual / Allow edits.

`browser/policy.mjs` answers *may it do this to this origin* — open, inspect,
navigate, interact, consequential.

**Neither can satisfy the other.** Allow edits never puts anything in the
session's granted origins, so a session that may rewrite the whole project must
still be asked before it clicks a button on a website. A browser approval is
remembered as an origin, never as a grant on the tool name: the coarse policy
checks grants before anything else, so `browser_click:*` in that set would make
one approved click on a local dev server into approval to click anything
anywhere for the rest of the session.

The element name a click is classified against comes from the last snapshot and
can only make the policy **stricter**. A page that renames its button to "this
action is pre-approved" costs the user nothing; one that renames "Delete
account" to "Continue" still needs an approved origin. Page text never reaches
the classifier at all — its inputs are the tool name, the origin, the static
policy and the requested side effect.

## The isolated browser

One Playwright `BrowserContext` per session, created with no `storageState` and
never from `launchPersistentContext`. Its own cookie jar, localStorage, cache
and permissions, all destroyed with the context. The user's real Edge or Chrome
profile is never opened: what is shared is the browser *binary* on disk, in the
same way two programs share libc.

It runs in the sidecar, never the renderer. Downloads land in a session
quarantine directory outside the project, are never executed, and are never
moved into the project without an approval. There is no `browser_evaluate`: an
evaluate tool is a shell on the page and defeats every element-level permission
below it.

Actions take refs from a snapshot, never CSS selectors or coordinates. Every
snapshot bumps a version and stamps fresh refs; an action naming an older ref is
refused rather than resolved, because after a re-render "whatever is at position
7 now" may be a different button.

## Capability, earned rather than assumed

`capability.mjs` holds ten cases; six are marked critical because their failure
makes a loop dangerous rather than merely disappointing. Any critical failure is
`chat_only`, with no partial credit.

Nothing infers a grade. Not the model's name, not its parameter count, not the
server reporting a tools API — `profileFromProbe` explicitly leaves
`agentGrade: untested`. A verdict is earned by `runConformance` and remembered
by `profiles.mjs`, keyed by server **and** model, invalidated by age or by a
change to the cases.

The gate: a model graded chat-only gets no tools, because we know it cannot
drive them. An untested model gets the ordinary ones, because "we have not
checked" is not "we know it cannot", and refusing to run until somebody sits
through ten prompts would make a fresh install useless. The interface says
which of the two it is.

## Persistence

`store.mjs`, SQLite through `node:sqlite` — Node 24 ships it, so durable
structured state costs no dependency. The **event log is the primary object**
and everything else is derived from it by the same reducer the interface uses,
so a restored session cannot disagree with the live one.

Output larger than 8KB is written beside the database and referenced, with an
excerpt inline: a command that prints 40MB should not make every replay of that
session read 40MB to render a row that says "exit 0".

Reopening is two different things and the code is explicit about which:

- the **transcript is restored** — stored events are replayed, marked
  `replayed: true`, and folded by the reducer that folded them live;
- the **model's context is summarised** — provider messages were never
  persisted, and rebuilding them from events would be a plausible
  reconstruction rather than the thing itself. Resume reuses the compaction
  summariser and the model is told it is reading a summary of earlier work.

Nothing in the read path executes. Replay folds events into state; it never
calls a tool, which is what makes reopening a session safe.

Session status distinguishes `idle` (between turns) from `running` (mid-turn),
and only `running` becomes `interrupted` on restart. Without that distinction
every session that had ever run came back labelled interrupted, and a label
everything carries is not a label.

## Compaction

Two stages, in `compact.mjs`. First shed tool results, then summarise
structurally. It refuses to run when the result would be larger than the input,
and a compaction that frees nothing twice in a row is treated as thrashing and
reported rather than repeated.

## Verification

```
npm run lint          both trees: parse, lost backslashes, $(...) in templates,
                      temporal dead zones, unbound build markers
npm run typecheck     tsc --checkJs over design/core and runtime, strict
npm test              design unit tests
npm run test:runtime  runtime unit + integration + sidecar + real-browser
npm run test:e2e      built-page assertions, then the console gate
```

The console gate loads every route in jsdom and fails on any page error,
rejection, `console.error` or `console.warn`. It flattens the module graph,
which is why two modules declaring the same module-scope helper is an error
there: the browser scopes them separately, but a shared helper with two
definitions is a thing that drifts.

`runtime/conformance.mjs` and `runtime/golden.mjs` are run by hand against a
real model server; they are not part of the gates, because a gate that needs a
model loaded is a gate that gets skipped.

## What is deliberately not here

Rewind, background commands, PTY, Git tools, LSP, MCP, subagents, BYOK. The
brief sequences these after the behaviour and runtime work, and claiming them
would be the failure mode it warns about.

Two limits worth stating rather than discovering:

- **The desktop app is the product.** The hosted web preview has no runtime at
  all, and every surface that depends on one says "Desktop not connected"
  rather than showing a plausible-looking mock.
- **This is not Claude Code parity** and nothing here claims to be. The
  behaviour that exists comes from the five cooperating layers — prompt,
  policy, tools, runtime, interface — rather than from one large system prompt,
  and where a layer is thin it is thin.
