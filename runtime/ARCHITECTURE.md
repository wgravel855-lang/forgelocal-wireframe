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
    tools/              one module per tool, each with a JSON Schema
    providers/          fake (deterministic) and openai-compatible
    orchestrator.mjs    the agent loop
  host/                 the Node host: local HTTP surface, session wiring
```

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

## What is deliberately not here yet

Milestone 2 and 3 items: SQLite persistence, rewind, compaction, background
commands, PTY, Git tools, LSP, MCP, subagents, BYOK. The brief sequences these
after the truthful vertical slice, and claiming them would be the failure mode
it warns about.
