// Every conversation in the prototype, in one shape.
//
// A thread is a list of turns. A user turn is { role:"user", text }. An
// assistant turn is { role:"assistant", blocks, activity, permission, recovery }
// and any of those may be absent.
//
// blocks     [{ t:"p" | "plan" | "code" | "note", ... }]
// activity   one group per assistant turn: state, summary, elapsed, rows, files
// permission a decision point attached to the turn that caused it
// recovery   the action row a stopped turn offers
//
// The facts here are the same facts the hand-written routes carried before;
// nothing was reworded for visual variety.

const runningActivity = {
  state: "running",
  label: "Working",
  elapsed: "14s",
  rows: [
    { icon: "done", label: "Read 4 files", meta: "1.2s" },
    { icon: "done", label: "Searched 21 files for localStorage", meta: "0.4s" },
    { icon: "done", label: "Edited 2 files", add: "+46", del: "−12" },
    { icon: "running", label: "npm test -- --run", mono: true, meta: "running",
      output: "> vitest --run\n\n ✓ src/App.test.jsx (3)\n · src/useTasks.test.js" },
  ],
};

export const threads = {
  /* -------------------------------------------------- built app routes --- */
  "route:running": {
    chat: "c1", state: "tool-running",
    composer: { placeholder: "Add to the plan, or ask a question", mode: "Build" },
    turns: [
      { role: "user", text: "Save the task list to localStorage so it survives a refresh, and add a test for it." },
      { role: "assistant",
        blocks: [
          { t: "p", text: "I will move state into a small hook so the components stay unaware of storage, then cover the reload behaviour with one test." },
          { t: "plan", title: "Plan", items: [
            { state: "done", label: "Read how state is handled today" },
            { state: "done", label: "Extract a useTasks hook backed by localStorage" },
            { state: "now", label: "Add a test that survives a reload" },
            { state: "todo", label: "Run the suite and report" },
          ] },
        ],
        activity: runningActivity },
    ],
  },

  "route:permission": {
    chat: "c1", state: "tool-running",
    composer: { placeholder: "Answer above, or send a different instruction", mode: "Build", blocked: true },
    turns: [
      { role: "user", text: "Save the task list to localStorage so it survives a refresh, and add a test for it." },
      { role: "assistant",
        blocks: [{ t: "p", text: "The hook is in place. The test needs a DOM environment, and this project has none installed." }],
        activity: {
          state: "paused", label: "Paused", elapsed: "22s",
          rows: [
            { icon: "done", label: "Read 4 files", meta: "1.2s" },
            { icon: "done", label: "Edited 2 files", add: "+46", del: "−12" },
          ],
        },
        permission: {
          title: "Install one package before running the test",
          scopeTag: "Network",
          command: "npm install --save-dev jsdom",
          why: "The test asserts that tasks reload after a refresh, which needs a DOM. Nothing in the project provides one.",
          cwd: "~/projects/task-tracker",
          scope: "Reaches the npm registry. Writes only inside node_modules and package.json.",
          reversible: "Yes, checkpoint 3 was taken before the last edit",
        } },
    ],
  },

  "route:stopped": {
    chat: "c3", state: "stopped",
    composer: { placeholder: "Tell me how to approach it differently", mode: "Plan" },
    turns: [
      { role: "user", text: "Switch the date helper over to the Temporal API." },
      { role: "assistant",
        blocks: [
          { t: "p", text: "I repeated the same fix three times without making progress. Each attempt rewrote the same two lines and hit the same failure, so I stopped rather than keep looping." },
          { t: "p", text: "Temporal is not available in this Node version, and no polyfill is installed. That is a project fact I cannot fix by editing the file." },
          { t: "note", tone: "ok", text: "Your working tree is untouched. Every edit sits behind checkpoint 2." },
        ],
        activity: {
          state: "stopped", label: "Stopped", summary: "same failure after 3 attempts", elapsed: "2m 11s",
          rows: [
            { icon: "done", label: "Read 6 files", meta: "1.8s" },
            { icon: "done", label: "Edited src/lib/date.js", add: "+21", del: "−19" },
            { icon: "fail", label: "Ran tests · 3 failed, same failure each time", meta: "×3" },
          ],
          diagnostics: {
            label: "The failure, unchanged across all three attempts",
            text: "TypeError: Temporal.PlainDate.from is not a function\n  at formatDue (src/lib/date.js:14:26)",
          },
        },
        recovery: {
          primary: { label: "Restore checkpoint 2", action: "restore" },
          alternatives: [
            { label: "Install a polyfill instead", href: "/app/permission/" },
            { label: "Keep the edits, stop here", action: "keep" },
          ],
          text: { label: "Open diagnostics", action: "diagnostics" },
        } },
    ],
  },

  /* ------------------------------------------------------ saved chats --- */
  c2: { chat: "c2", state: "complete", turns: [
    { role: "user", text: "Add a filter bar above the list so I can show all, active or done." },
    { role: "assistant",
      blocks: [{ t: "p", text: "Added a filter bar as a controlled component above the list. The filter is a single piece of state in App, so the list stays the only thing that knows how to render a task." }],
      activity: { state: "complete", label: "Completed", elapsed: "31s",
        rows: [
          { icon: "done", label: "Read 3 files", meta: "0.9s" },
          { icon: "done", label: "Edited 2 files", add: "+34", del: "−21" },
          { icon: "done", label: "npm test -- --run", mono: true, meta: "3.1s" },
        ],
        files: [["src/App.jsx", "+34", "−21"], ["src/FilterBar.jsx", "new", ""]],
        tests: "3 tests passed", exit: "exit 0" } },
  ] },

  c4: { chat: "c4", state: "complete", turns: [
    { role: "user", text: "Set up a Vite React project called task-tracker with a basic list." },
    { role: "assistant",
      blocks: [{ t: "p", text: "Created the project with Vite's react template and a single App component holding an in-memory list. No state library and no router: neither is needed yet." }],
      activity: { state: "complete", label: "Completed", elapsed: "1m 12s",
        rows: [
          { icon: "done", label: "npm create vite@latest", mono: true, meta: "42s" },
          { icon: "done", label: "Installed 2 packages", meta: "18s" },
          { icon: "done", label: "Edited 4 files" },
        ],
        files: [["package.json", "new", ""], ["src/App.jsx", "new", ""], ["index.html", "new", ""]],
        tests: "No tests yet", exit: "exit 0" } },
  ] },

  c5: { chat: "c5", state: "complete", turns: [
    { role: "user", text: "Add Vitest and one test that proves adding a task works." },
    { role: "assistant",
      blocks: [
        { t: "p", text: "Added Vitest with jsdom and a single test that renders App, adds a task and asserts it is listed. The test script runs in watch mode locally and once in CI." },
        { t: "code", file: "package.json", lang: "json", code: '"scripts": {\n  "test": "vitest",\n  "test:ci": "vitest --run"\n}' },
      ],
      activity: { state: "complete", label: "Completed", elapsed: "48s",
        rows: [
          { icon: "done", label: "Installed 3 packages", meta: "21s" },
          { icon: "done", label: "Edited 2 files", add: "+4", del: "" },
          { icon: "done", label: "npm test -- --run", mono: true, meta: "2.4s" },
        ],
        files: [["package.json", "+4", ""], ["src/App.test.jsx", "new", ""]],
        tests: "1 test passed", exit: "exit 0" } },
  ] },

  c6: { chat: "c6", state: "complete", turns: [
    { role: "user", text: "Request logging is noisy in development. Put it behind a flag." },
    { role: "assistant",
      blocks: [{ t: "p", text: "Logging now reads a DEBUG_HTTP flag and is off unless it is set. The call sites are unchanged, so nothing else had to move." }],
      activity: { state: "complete", label: "Completed", elapsed: "26s",
        rows: [
          { icon: "done", label: "Searched 14 files", meta: "0.6s" },
          { icon: "done", label: "Edited 3 files", add: "+14", del: "−6" },
        ],
        files: [["src/log.js", "+12", "−4"], ["src/server.js", "+2", "−2"]],
        tests: "4 tests passed", exit: "exit 0" } },
  ] },

  c7: { chat: "c7", state: "complete", turns: [
    { role: "user", text: "The card grid is copied on three pages. Pull it into one component." },
    { role: "assistant",
      blocks: [{ t: "p", text: "Extracted the grid into CardGrid.astro and replaced all three copies. The markup was identical apart from the heading, so that is the only prop it takes." }],
      activity: { state: "complete", label: "Completed", elapsed: "54s",
        rows: [
          { icon: "done", label: "Read 6 files", meta: "1.1s" },
          { icon: "done", label: "Edited 4 files", add: "+9", del: "−82" },
          { icon: "done", label: "npm run build", mono: true, meta: "6.8s" },
        ],
        files: [["src/components/CardGrid.astro", "new", ""], ["src/pages/index.astro", "+3", "−28"],
          ["src/pages/work.astro", "+3", "−28"], ["src/pages/writing.astro", "+3", "−26"]],
        tests: "Build succeeded", exit: "exit 0" } },
  ] },

  c8: { chat: "c8", state: "complete", turns: [
    { role: "user", text: "The nav links fail contrast on the dark header. Fix them." },
    { role: "assistant",
      blocks: [{ t: "p", text: "Raised the muted link colour until it clears 4.5:1 against the header background, and left the hover state alone because it already passed." }],
      activity: { state: "complete", label: "Completed", elapsed: "19s",
        rows: [
          { icon: "done", label: "Read 2 files", meta: "0.5s" },
          { icon: "done", label: "Edited 1 file", add: "+2", del: "−2" },
        ],
        files: [["src/styles/tokens.css", "+2", "−2"]],
        tests: "Build succeeded", exit: "exit 0" } },
  ] },

  c9: { chat: "c9", state: "complete", turns: [
    { role: "user", text: "Add rate limiting to the public routes, 60 requests a minute." },
    { role: "assistant",
      blocks: [
        { t: "p", text: "Registered @fastify/rate-limit on the public route prefix only. The internal prefix is untouched, so service-to-service calls are not throttled." },
        { t: "code", file: "src/server.js", lang: "js", code: "app.register(rateLimit, {\n  max: 60,\n  timeWindow: '1 minute',\n  keyGenerator: (req) => req.ip,\n});" },
      ],
      activity: { state: "complete", label: "Completed", elapsed: "37s",
        rows: [
          { icon: "done", label: "Installed 1 package", meta: "9s" },
          { icon: "done", label: "Edited 2 files", add: "+12", del: "−1" },
          { icon: "done", label: "npm test -- --run", mono: true, meta: "4.0s" },
        ],
        files: [["src/server.js", "+9", ""], ["src/routes/public.js", "+3", "−1"]],
        tests: "11 tests passed", exit: "exit 0" } },
  ] },
};
