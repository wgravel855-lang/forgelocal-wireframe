# ForgeLocal wireframe

Greybox screens for a local coding agent: it detects what the machine can run,
installs a suitable open model, gives that model bounded coding tools, and keeps
the whole thing reviewable from one desktop workspace.

This repo is a **wireframe**, not an implementation. Nothing here is wired up.

`ForgeLocal` is a provisional name. [docs/screen-map.md](docs/screen-map.md) asks
for a clean-room name of its own; run a trademark and domain search before using
one publicly.

## Viewing

`index.html` at the repo root is a gallery of every screen. It is plain static
HTML with no build step and no dependencies, so any static host serves it as is.

Locally:

```bash
node design/serve.mjs
```

Then open <http://localhost:4315>.

## Layout

```
index.html          gallery of all screens, grouped by area
screens/*.html      one standalone page per screen
design/
  parts/*.body.html the actual source for each screen
  head.part         shared design tokens and component CSS
  canvas.json       screen inventory: grouping, titles, frame sizes
  build.sh          parts -> design-canvas artboards
  build-site.mjs    parts -> this static site
  serve.mjs         local static server
docs/screen-map.md  the product screen map this is built to
```

Edit a screen in `design/parts/`, then regenerate:

```bash
node design/build-site.mjs
```

`design/head.part` holds the whole design system. `:root` carries the light
marketing palette; `.app` overrides it with the near-black desktop shell. Both
share one set of component classes, so a screen opts into the app shell by
adding `class="win app"` to its root element.

## What is here

**Workspace** — the product. Conversation-first: a collapsible session sidebar,
a centered readable column, and a composer. No permanent file tree, terminal,
diff or preview. Those live in one context drawer that stays shut until there is
something to inspect. Five screens: empty, agent running, permission request,
change review with the drawer open, and the model picker.

**Onboarding** — hardware scan, runtime setup, model recommendation, download,
project setup, permission preset. Still in the light shell from an earlier
brief; needs restyling into the app shell.

**Marketing site** — home, model catalog, security.

**Superseded** — earlier screens built on a permanent three-panel IDE layout,
before the screen map locked the workspace as conversation-first. Kept for the
content only. Do not build from them.

## Conventions

Bracketed values such as `[model:tag]`, `[N]`, `[date]` are deliberate
placeholders. Verified-check counts stay blank until a real compatibility suite
has run; the screens should never publish a number that was never measured.

Reference screenshots of other products are excluded from this repo. They were
used for information architecture, density and hierarchy only.
