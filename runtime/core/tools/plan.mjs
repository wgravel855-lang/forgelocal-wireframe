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

/**
 * A question the user answers by choosing, not by writing an essay.
 *
 * The old shape was one free-text question and a flat list of strings. That
 * gave the interface nothing to render but a prompt and some buttons, and it
 * gave the user no way to see what each choice would cost them. Each option
 * now carries its own one-line consequence, one is marked as the
 * recommendation so a user who does not want to adjudicate can take it, and a
 * question may accept several answers where the choices are genuinely not
 * exclusive.
 *
 * At most three questions, and only when they are parts of one decision.
 * Three separate decisions are three pauses, because answering the second
 * usually depends on having seen the consequence of the first.
 */
export const askUserSchema = assertStrictSchema({
  type: "object",
  additionalProperties: false,
  required: ["questions"],
  properties: {
    questions: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      description:
        "One question, or at most three parts of the same decision. Ask only what you "
        + "cannot settle by reading the project.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["header", "question", "options"],
        properties: {
          header: {
            type: "string", minLength: 1, maxLength: 16,
            description: "Two or three words naming the decision, for the card's label.",
          },
          question: {
            type: "string", minLength: 1, maxLength: 300,
            description: "The question itself, ending in a question mark.",
          },
          multiSelect: {
            type: "boolean",
            description: "True only when the options are genuinely combinable.",
          },
          options: {
            type: "array", minItems: 2, maxItems: 4,
            description: "Mutually exclusive choices unless multiSelect is true. Put the one you recommend first.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label", "description"],
              properties: {
                label: { type: "string", minLength: 1, maxLength: 60 },
                description: {
                  type: "string", minLength: 1, maxLength: 200,
                  description: "What choosing this means, in one line. Name the tradeoff.",
                },
                recommended: { type: "boolean" },
              },
            },
          },
        },
      },
    },
  },
});

/**
 * Asking suspends the turn. The tool itself only records the question; the
 * orchestrator is what stops, because resuming needs the session, not the tool.
 * @param {any} _ctx
 * @param {{questions?: Array<{header?: string, question: string,
 *   multiSelect?: boolean, options?: Array<{label: string,
 *   description?: string, recommended?: boolean}>}>}} args
 */
export function askUser(_ctx, args) {
  /* The first option is the recommendation unless one says otherwise. The
     model is told to put it first; this makes the card agree with the schema
     even when the model ignores the ordering. */
  const questions = (args.questions ?? []).map((q, i) => {
    const options = (q.options ?? []).map((o) => ({
      label: o.label,
      description: o.description,
      recommended: o.recommended === true,
    }));
    if (options.length && !options.some((o) => o.recommended)) options[0].recommended = true;
    return {
      id: `q${i}`,
      header: q.header,
      question: q.question,
      multiSelect: q.multiSelect === true,
      options,
    };
  });

  return { ok: true, questions, awaiting: true };
}
