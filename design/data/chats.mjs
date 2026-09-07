// One source of truth for the chat selector and the workspace it drives.
//
// These are prototype fixtures, the same class as the workspace transcript:
// nothing here is real history. Three projects exist because the selector's
// "Move to project" action has to move a chat somewhere.

export const projects = [
  { id: "task-tracker", name: "task-tracker",
    path: "~/projects/task-tracker", branch: "Git repo, on main",
    stack: "Vite + React detected" },
  { id: "portfolio-site", name: "portfolio-site",
    path: "~/projects/portfolio-site", branch: "Git repo, on redesign",
    stack: "Astro + Tailwind detected" },
  { id: "api-gateway", name: "api-gateway",
    path: "~/projects/api-gateway", branch: "Git repo, on main",
    stack: "Node + Fastify detected" },
];

// bucket: today | week | older. Pinned is a per-chat flag, not a bucket, so a
// pinned chat keeps its date for when it is unpinned again.
// route: only where a built screen exists. Those chats open that screen.
// view:  the saved state every other chat renders in the workspace, so a
//        historical chat never sits above an empty new-session screen.
// state: drives the leading indicator. running | done | failed | idle
export const chats = [
  { id: "c1", title: "Persist tasks to localStorage", project: "task-tracker",
    bucket: "today", pinned: true, state: "running", route: "/app/running/" },
  { id: "c2", title: "Add a filter bar to the list", project: "task-tracker",
    bucket: "today", state: "done",
    view: {
      prompt: "Add a filter bar above the list so I can show all, active or done.",
      reply: "Added a filter bar as a controlled component above the list. The filter is a single piece of state in App, so the list stays the only thing that knows how to render a task.",
      steps: ["Read 3 files", "Edited 2 files", "npm test -- --run"],
      files: [["src/App.jsx", "+34", "−21"], ["src/FilterBar.jsx", "new", ""]],
      tests: "3 tests passed", exit: "exit 0" } },
  { id: "c3", title: "Switch the date helper to Temporal", project: "task-tracker",
    bucket: "today", state: "failed", route: "/app/stopped/" },
  { id: "c4", title: "Scaffold the project", project: "task-tracker",
    bucket: "week", state: "done",
    view: {
      prompt: "Set up a Vite React project called task-tracker with a basic list.",
      reply: "Created the project with Vite's react template and a single App component holding an in-memory list. No state library and no router: neither is needed yet.",
      steps: ["npm create vite@latest", "Installed 2 packages", "Edited 4 files"],
      files: [["package.json", "new", ""], ["src/App.jsx", "new", ""], ["index.html", "new", ""]],
      tests: "No tests yet", exit: "exit 0" } },
  { id: "c5", title: "Set up Vitest", project: "task-tracker",
    bucket: "week", state: "done",
    view: {
      prompt: "Add Vitest and one test that proves adding a task works.",
      reply: "Added Vitest with jsdom and a single test that renders App, adds a task and asserts it is listed. The test script runs in watch mode locally and once in CI.",
      steps: ["Install 3 packages", "Edited 2 files", "npm test -- --run"],
      files: [["package.json", "+4", ""], ["src/App.test.jsx", "new", ""]],
      tests: "1 test passed", exit: "exit 0" } },
  { id: "c6", title: "Move request logging behind a flag", project: "task-tracker",
    bucket: "older", state: "done",
    view: {
      prompt: "Request logging is noisy in development. Put it behind a flag.",
      reply: "Logging now reads a DEBUG_HTTP flag and is off unless it is set. The call sites are unchanged, so nothing else had to move.",
      steps: ["Searched 14 files", "Edited 3 files"],
      files: [["src/log.js", "+12", "−4"], ["src/server.js", "+2", "−2"]],
      tests: "4 tests passed", exit: "exit 0" } },
  { id: "c7", title: "Extract the card grid into a component", project: "portfolio-site",
    bucket: "week", state: "done",
    view: {
      prompt: "The card grid is copied on three pages. Pull it into one component.",
      reply: "Extracted the grid into CardGrid.astro and replaced all three copies. The markup was identical apart from the heading, so that is the only prop it takes.",
      steps: ["Read 6 files", "Edited 4 files", "npm run build"],
      files: [["src/components/CardGrid.astro", "new", ""], ["src/pages/index.astro", "+3", "−28"],
        ["src/pages/work.astro", "+3", "−28"], ["src/pages/writing.astro", "+3", "−26"]],
      tests: "Build succeeded", exit: "exit 0" } },
  { id: "c8", title: "Fix the contrast on the dark header", project: "portfolio-site",
    bucket: "older", state: "done",
    view: {
      prompt: "The nav links fail contrast on the dark header. Fix them.",
      reply: "Raised the muted link colour until it clears 4.5:1 against the header background, and left the hover state alone because it already passed.",
      steps: ["Read 2 files", "Edited 1 file"],
      files: [["src/styles/tokens.css", "+2", "−2"]],
      tests: "Build succeeded", exit: "exit 0" } },
  { id: "c9", title: "Rate limit the public endpoints", project: "api-gateway",
    bucket: "older", state: "done",
    view: {
      prompt: "Add rate limiting to the public routes, 60 requests a minute.",
      reply: "Registered @fastify/rate-limit on the public route prefix only. The internal prefix is untouched, so service-to-service calls are not throttled.",
      steps: ["Install 1 package", "Edited 2 files", "npm test -- --run"],
      files: [["src/server.js", "+9", ""], ["src/routes/public.js", "+3", "−1"]],
      tests: "11 tests passed", exit: "exit 0" } },
];

export const GROUPS = [
  ["pinned", "Pinned"],
  ["today", "Today"],
  ["week", "Previous 7 days"],
  ["older", "Older"],
];
