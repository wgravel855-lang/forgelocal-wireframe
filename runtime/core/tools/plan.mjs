// @ts-check
/**
 * `update_plan` and `ask_user`.
 *
 * Neither touches the machine. They exist so the model has a structured way to
 * say what it intends and to stop and ask, instead of narrating a plan into
 * prose the interface then has to guess at, or inventing an answer to a
 * question only the user can settle.
 */

import { assertStrictSchema } from "../schema.mjs";

export const PlanStatus = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  DONE: "done",
  BLOCKED: "blocked",
});

export const updatePlanSchema = assertStrictSchema({
  type: "object",
  additionalProperties: false,
  required: ["steps"],
  properties: {
    steps: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      description: "The whole plan, every time. Send the full list, not a change to it.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["step", "status"],
        properties: {
          step: { type: "string", minLength: 1, maxLength: 200 },
          status: {
            type: "string",
            enum: [PlanStatus.PENDING, PlanStatus.ACTIVE, PlanStatus.DONE, PlanStatus.BLOCKED],
          },
          note: { type: "string", maxLength: 300, description: "Only when blocked or surprising." },
        },
      },
    },
  },
});

/**
 * The plan is replaced wholesale rather than patched, because a model that
 * sends deltas eventually sends one that does not apply, and a half-updated
 * plan is worse than a stale one.
 *
 * @param {{plan?: any}} ctx
 * @param {{steps: any[]}} args
 */
export function updatePlan(ctx, args) {
  const steps = args.steps.map((s) => ({
    step: s.step,
    status: s.status,
    note: s.note ?? null,
  }));
  const active = steps.filter((s) => s.status === PlanStatus.ACTIVE);
  if (active.length > 1) {
    // Two things at once is almost always a mistake in the model's bookkeeping,
    // and the interface can only highlight one current step.
    return {
      ok: false,
      error: `Only one step may be active at a time; ${active.length} were marked active.`,
      steps,
    };
  }
  ctx.plan = steps;
  return {
    ok: true,
    steps,
    done: steps.filter((s) => s.status === PlanStatus.DONE).length,
    total: steps.length,
  };
}

export const askUserSchema = assertStrictSchema({
  type: "object",
  additionalProperties: false,
  required: ["question"],
  properties: {
    question: {
      type: "string", minLength: 1, maxLength: 500,
      description: "One question, answerable in a sentence. Ask only what you cannot determine by reading the project.",
    },
    options: {
      type: "array", maxItems: 5,
      items: { type: "string", maxLength: 80 },
      description: "Optional short answers to offer.",
    },
  },
});

/**
 * Asking suspends the turn. The tool itself only records the question; the
 * orchestrator is what stops, because resuming needs the session, not the tool.
 * @param {any} _ctx @param {{question: string, options?: string[]}} args
 */
export function askUser(_ctx, args) {
  return {
    ok: true,
    question: args.question,
    options: args.options ?? [],
    awaiting: true,
  };
}
