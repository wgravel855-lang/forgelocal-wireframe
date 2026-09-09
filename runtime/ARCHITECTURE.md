# ForgeLocal agent runtime — architecture and decisions

## The decision the brief asks for

The brief specifies a Tauri v2 desktop host with Rust owning every privileged
operation. This repository had **no desktop stack at all** before this pass: it
is a static site generator plus one vanilla ES-module controller. So nothing was
displaced, but a stack was chosen, and the brief requires that choice be stated
rather than made silently.

**What was built: a privileged Node runtime process, separate from the
renderer, with the privileged core written transport-agnostically so a Rust host
can replace the Node host without rewriting the agent.**

Why, honestly:

- Rust 1.97 and cargo are installed on the development machine, so Tauri was
  *possible*. It was not attempted because a Tauri shell, its IPC surface, its
  packaging and its signing are a milestone of their own, and Milestone 1 is
  defined by the runtime being real — "not done if only the UI or TypeScript
  interfaces exist". Splitting the effort would have produced a half-built shell
  around a half-built agent.
- The trust boundary the brief cares about is that **the renderer must never
  hold filesystem or shell authority**. That boundary is real here: the browser
  page holds none. Every privileged operation happens in a separate OS process
  that the page can only reach through a narrow, schema-validated local HTTP
  surface bound to `127.0.0.1`, and every request is re-validated inside that
  process. Moving the host from Node to Rust changes who enforces the boundary,
  not whether one exists.
- `runtime/core/` has no HTTP, no DOM and no Node-host assumptions beyond
  `node:fs` and `node:child_process`. Porting means reimplementing the host and
  the two adapters, not the orchestrator, tool contracts, permission policy,
  path containment or event protocol.

### What this costs, stated plainly

A Node host is **not** the isolation a Rust/Tauri host would give. The runtime
process runs with the user's full privileges. Command execution here is
permission-gated, not sandboxed. That is the same honest description the brief
demands for native Windows execution, and it applies to the host as well as to
the commands.

## Layout

```
runtime/
  core/                 privileged, transport-agnostic, no DOM
    paths.mjs           canonicalisation and root containment
    events.mjs          the normalized event protocol and its reducer
    permissions.mjs     Plan / Manual / Allow edits policy
    danger.mjs          the always-block and always-confirm classifier
    schema.mjs          the strict JSON Schema validator
    secrets.mjs         redaction and the child-process env allowlist
    context.mjs         system prompt, project instructions, ledger, accounting
    orchestrator.mjs    the agent loop
    tools/              read, patch, command, plan; index.mjs is the registry
    providers/          fake (deterministic) and openai-compatible
  golden.mjs            the end-to-end task, run against a real model
  host/                 the Node host: local HTTP surface, session wiring
```

`host/` does not exist yet. The orchestrator is driven directly by
`runtime/golden.mjs` and by the integration tests, which is the same entry point
a host would use.

## The loop

The orchestrator owns it, and it is a service with no DOM dependency, so an
integration test drives the identical code path the desktop app would:

1. build a working context from instructions, digest, recent turns and ledger;
2. ask the provider for a turn, streaming;
3. normalize deltas into events;
4. parse and validate tool calls against their schemas;
5. evaluate the permission policy;
6. execute approved tools, or emit `permission_required` and suspend;
7. append a normalized tool result;
8. update plan, ledger, checkpoint and context accounting;
9. call the model again;
10. stop on a final response, a user interrupt, a limit, or an unrecoverable
    error — never because a tool merely finished.

## What the first real runs taught

Three defects only a real model on a real server could have found. All three
were in this code, not the model's.

**The tool grammar.** A local server builds a GBNF grammar from the tool schemas
to constrain output. A JSON Schema length bound becomes a bounded repetition in
that grammar, and `apply_patch` declared `maxLength: 500000` on `content`. Sent
together, the eight tools produced `Failed to initialize samplers: failed to
parse grammar` and then killed the inference engine outright — after which every
later request failed with `fetch failed`, which made the bisect look like five
broken tools instead of one. `toolSpecs()` now sends a slimmed wire schema with
the size and range bounds removed. This costs nothing in safety: the grammar is
guidance, and `validateCall()` still checks the full strict schema before
anything executes. That check, not the grammar, is what gates execution.

**A doubled tool name.** This server repeats the complete function name on every
chunk of a streaming tool call. The adapter appended, so `list_directory` became
`list_directorylist_directory`, and the model was told three times that its tool
did not exist before the loop gave up. Repeats are now ignored and genuine
fragments still append.

**An empty stream read as a final answer.** When the grammar failed, the server
answered 200 and streamed nothing. The adapter normalized "no text, no calls, no
finish reason" to `final`, so a server-side failure looked like a model that had
nothing to say and the run reported success with zero work done. That case is
now a `BAD_RESPONSE` error.

There was also a fourth finding that was not a defect in the runtime at all: the
golden fixture documented its tests as `node --test src/`, which fails on Node 24
even when the code is correct, because `src` is treated as a test file rather
than a directory. The agent said so in its transcript and was right; the harness
was wrong.

## What is deliberately not here yet

Milestone 2 and 3 items: SQLite persistence, rewind, compaction, background
commands, PTY, Git tools, LSP, MCP, subagents, BYOK. The brief sequences these
after the truthful vertical slice, and claiming them would be the failure mode
it warns about.
