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

**Workspace** — the product, conversation-first. A collapsible 248px session
sidebar, a 48px top bar, a 792px reading column and a familiar composer. No
permanent file tree, terminal, diff or preview, and no bottom status bar.
Finished low-risk work collapses into one activity group; only the current
action stays open. Eight screens: empty, running, permission request, change
review with the drawer open, stopped after no progress, the model picker,
Explore and My models.

**Onboarding** — five steps in the same dark shell: welcome and scan, hardware
result with one recommended profile, combined runtime and model install, project
and permissions, then the real workspace. There is no congratulations page.

**Marketing site** — home, model catalog, security. Light surface. The hero
shows the actual workspace, built from the same components and tokens as the
app rather than a placeholder image.

**Superseded** — the original three-panel IDE layout and the eleven-step light
onboarding. Kept for content worth porting. Do not build from them.

## Shared pieces

`design/head.part` is the whole design system: tokens, layout primitives,
controls, motion and the responsive rules. `:root` carries the light marketing
palette and `.app` overrides it with the near-black desktop shell, so one set
of component classes serves both.

`design/partials/` holds the sidebar, top bar, composer, status chips and the
homepage workspace demo. Screens pull them in with
`<!--#include sidebar.html {"active":"s1"} -->`, so the shell cannot drift
between screens. `design/lib/assemble.mjs` expands those includes.

Each artboard in `canvas.json` declares a `mode`: `app` fills the viewport and
scrolls internally, `page` flows at full width, `fixed` is a legacy canvas.

## Verified

Every non-superseded screen was checked in a browser at 1920, 1440, 1366, 1024
and 768 for horizontal overflow, a composer pushed below the fold and clipped
sidebar text, and every text node was checked against WCAG AA contrast. All
pass.

## Conventions

Bracketed values such as `[model:tag]`, `[N]`, `[date]` are deliberate
placeholders. Verified-check counts stay blank until a real compatibility suite
has run; the screens should never publish a number that was never measured.

Reference screenshots of other products are excluded from this repo. They were
used for information architecture, density and hierarchy only.
