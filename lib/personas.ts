// The AI panel. Each persona is one Jev "noul" (yes/no) question about the
// paper's title and abstract. Jev reads questions literally and has no notion
// of role-play, so each persona is written as the concrete condition that
// reviewer would check. A yes probability of at least 0.5 counts as "fresh".
// Edit freely: these strings are the whole persona definition.

export const PERSONAS = {
  method: {
    name: "The Methodologist",
    focus: "rigor, baselines, statistics",
    instructions:
      "Does `abstract` describe an evaluation broad enough to support its main claim, such as several datasets, models, or settings with comparisons to existing methods?",
    criteria: {
      true: "Experiments span more than one model, dataset, or setting and are compared against baselines",
      false: "Evaluation is a single model or dataset, synthetic only, or not described",
    },
  },
  novelty: {
    name: "The Novelty Hunter",
    focus: "is the idea new?",
    instructions:
      "Does `abstract` introduce a new problem setting, finding, or technique, rather than applying a known method to a new dataset?",
    criteria: {
      true: "Claims a first-of-its-kind setting, a new finding, or a technique not described before",
      false: "Combines or tunes known techniques, or reports results of an existing method on new data",
    },
  },
  prac: {
    name: "The Practitioner",
    focus: "cost, code, deployability",
    instructions:
      "Could an engineer adopt the result described in `abstract`, for example because code is released, compute cost is modest, or the method plugs into existing systems?",
    criteria: {
      true: "Mentions released code, efficiency, low cost, or a drop-in component",
      false: "Requires large training runs, special infrastructure, or gives no sign of usable artifacts",
    },
  },
  r2: {
    name: "Reviewer 2",
    focus: "finds the weakest claim",
    instructions:
      "Are the claims in `abstract` precise and proportionate to the evidence it describes?",
    criteria: {
      true: "Claims are specific and testable, and match the scope of the experiments described",
      false: "Uses broad words like law, universal, or first without matching evidence, or claims outrun the experiments",
    },
  },
  general: {
    name: "The Generalist",
    focus: "clarity and reach",
    instructions:
      "Would a machine learning researcher outside this subfield understand from `abstract` what problem is solved and why it matters?",
    criteria: {
      true: "States the problem, the approach, and the payoff in plain terms",
      false: "Relies on subfield jargon or never says why the problem matters",
    },
  },
} as const;

export type PersonaId = keyof typeof PERSONAS;
export const PERSONA_IDS = Object.keys(PERSONAS) as PersonaId[];
