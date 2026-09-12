// @ts-check
/**
 * The normalized event protocol.
 *
 * The implementation lives in `design/core/agentevents.mjs` because the
 * renderer needs the identical reducer: "events replay to the same UI state"
 * is only a guarantee if the runtime that writes them and the interface that
 * folds them are running the same code, not two copies that agree today.
 *
 * design/core is the directory the build copies to public/core, so the browser
 * can import it. This file re-exports it so the runtime's own imports read
 * naturally and never reach across the tree.
 */
export * from "../../design/core/agentevents.mjs";
