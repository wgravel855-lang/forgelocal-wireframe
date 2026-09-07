// Prototype fixtures for the chat selector.
//
// These are example sessions, the same class of fixture as the workspace
// transcript: nothing here is real history. Three projects exist because the
// selector's "Move to project" action has to move a chat somewhere, and one
// project would make that action a lie.

export const projects = [
  { id: "task-tracker", name: "task-tracker" },
  { id: "portfolio-site", name: "portfolio-site" },
  { id: "api-gateway", name: "api-gateway" },
];

// bucket: today | week | older. Pinned is a per-chat flag, not a bucket, so a
// pinned chat keeps its date for when it is unpinned again.
// route: only set where a built screen exists for that chat.
// state: drives the leading indicator. running | done | failed | idle
export const chats = [
  { id: "c1", title: "Persist tasks to localStorage", project: "task-tracker",
    bucket: "today", pinned: true, state: "running", route: "/app/running/" },
  { id: "c2", title: "Add a filter bar to the list", project: "task-tracker",
    bucket: "today", state: "done" },
  { id: "c3", title: "Switch the date helper to Temporal", project: "task-tracker",
    bucket: "today", state: "failed", route: "/app/stopped/" },
  { id: "c4", title: "Scaffold the project", project: "task-tracker",
    bucket: "week", state: "done" },
  { id: "c5", title: "Set up Vitest", project: "task-tracker",
    bucket: "week", state: "done" },
  { id: "c6", title: "Move request logging behind a flag", project: "task-tracker",
    bucket: "older", state: "done" },
  { id: "c7", title: "Extract the card grid into a component", project: "portfolio-site",
    bucket: "week", state: "done" },
  { id: "c8", title: "Fix the contrast on the dark header", project: "portfolio-site",
    bucket: "older", state: "done" },
  { id: "c9", title: "Rate limit the public endpoints", project: "api-gateway",
    bucket: "older", state: "done" },
];

export const GROUPS = [
  ["pinned", "Pinned"],
  ["today", "Today"],
  ["week", "Previous 7 days"],
  ["older", "Older"],
];
