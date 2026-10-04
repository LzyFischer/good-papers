// The AI panel: 20 reviewers, each one Jev "noul" (yes/no) question about the
// paper's title and abstract. Jev reads questions literally and has no notion
// of role-play, so a persona's identity lives entirely in the concrete
// condition it checks. Personas differ in what they value and in how strict
// that condition is (tier), so good papers rarely get 20/20 and weak ones
// rarely 0/20. A yes probability of at least `bar` (default 0.5) counts as
// "fresh". Jev's wording alone is close to all-or-nothing, so personas that
// said yes to nearly everything got a higher bar, calibrated on ~64 recent
// arXiv ML papers to put lenient ≈ 55-90%, medium ≈ 30-55%, strict ≈ 5-25%.
// Edit freely: these strings are the whole persona definition.

export type Tier = "lenient" | "medium" | "strict";

type Persona = {
  name: string;
  focus: string;
  tier: Tier;
  bar?: number; // yes probability needed for "fresh"; default 0.5, never below it
  instructions: string;
  criteria: { true: string; false: string };
};

export const PERSONAS = {
  // Lenient: most competent papers pass.
  student: {
    name: "First-year PhD student",
    focus: "is it interesting?",
    tier: "lenient",
    instructions:
      "Does `abstract` describe an idea that a first-year machine learning PhD student would find interesting and could follow?",
    criteria: {
      true: "The problem and idea are understandable and spark curiosity",
      false: "The idea is impenetrable, trivial, or the abstract never says what was done",
    },
  },
  generalist: {
    name: "The Generalist",
    focus: "clarity and reach",
    tier: "lenient",
    instructions:
      "Would a machine learning researcher outside this subfield understand from `abstract` what problem is solved and why it matters?",
    criteria: {
      true: "States the problem, the approach, and the payoff in plain terms",
      false: "Relies on subfield jargon or never says why the problem matters",
    },
  },
  teacher: {
    name: "Course instructor",
    focus: "worth teaching?",
    tier: "lenient",
    instructions:
      "Does `abstract` contain a concept, finding, or technique general enough to be worth mentioning in a graduate machine learning course?",
    criteria: {
      true: "A reusable idea or finding that transfers beyond this one paper",
      false: "A narrow engineering tweak or application with no general lesson",
    },
  },
  bridge: {
    name: "Cross-disciplinary reader",
    focus: "real-world relevance",
    tier: "lenient",
    instructions:
      "Does `abstract` connect its work to a concrete real-world problem, application domain, or user need?",
    criteria: {
      true: "Names a real application, domain, or practical need the work serves",
      false: "Purely abstract benchmark chasing with no stated real-world motivation",
    },
  },
  trend: {
    name: "Trend watcher",
    focus: "timely topic",
    tier: "lenient",
    bar: 0.9,
    instructions:
      "Does `abstract` address a question that the machine learning community is actively working on right now?",
    criteria: {
      true: "Tackles a current open question in an active research area",
      false: "Revisits a settled or niche question with little current interest",
    },
  },

  // Medium: a solid paper passes, an ordinary one splits the vote.
  method: {
    name: "The Methodologist",
    focus: "rigor, baselines",
    tier: "medium",
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
    tier: "medium",
    bar: 0.76,
    instructions:
      "Does `abstract` introduce a new problem setting, finding, or technique that goes beyond a straightforward variant of existing methods?",
    criteria: {
      true: "A new setting, a new finding, or a technique with a clearly different core idea from prior work",
      false: "A routine variant or combination of known components, or a known method applied to new data",
    },
  },
  prac: {
    name: "The Practitioner",
    focus: "deployability",
    tier: "medium",
    instructions:
      "Could an engineer adopt the result described in `abstract`, for example because code is released, compute cost is modest, or the method plugs into existing systems?",
    criteria: {
      true: "Mentions released code, efficiency, low cost, or a drop-in component",
      false: "Requires large training runs, special infrastructure, or gives no sign of usable artifacts",
    },
  },
  motivation: {
    name: "Motivation critic",
    focus: "why is this needed?",
    tier: "medium",
    bar: 0.94,
    instructions:
      "Does `abstract` name a specific limitation of prior methods, beyond saying the topic matters, and design its approach around that limitation?",
    criteria: {
      true: "A concrete shortcoming of existing methods is named and the approach is built to fix it",
      false: "Motivation is generic ('X is important'), or the stated gap is unrelated to what the method does",
    },
  },
  ablation: {
    name: "Ablation fan",
    focus: "why does it work?",
    tier: "medium",
    instructions:
      "Does `abstract` report analysis of why the approach works, such as ablations, diagnostic experiments, or an explanation of the mechanism?",
    criteria: {
      true: "Mentions ablations, analysis, or a mechanism behind the results",
      false: "Reports only headline scores with no analysis of what drives them",
    },
  },
  efficiency: {
    name: "Compute-conscious reviewer",
    focus: "cost vs gain",
    tier: "medium",
    instructions:
      "Does `abstract` suggest the gains come without a large increase in compute, data, or model size, or that the method reduces cost?",
    criteria: {
      true: "Claims efficiency, lower cost, or gains at comparable compute",
      false: "Gains appear to come from more compute, data, or parameters, or cost is ignored",
    },
  },
  repro: {
    name: "Reproducibility checker",
    focus: "can I rerun it?",
    tier: "medium",
    instructions:
      "Does `abstract` give enough concrete detail to reproduce the work, such as released code or data, or named public datasets and models?",
    criteria: {
      true: "Code or data is released, or public datasets and models are named",
      false: "Private data, unnamed models, or no concrete experimental details",
    },
  },
  benchmarks: {
    name: "Domain expert",
    focus: "standard benchmarks",
    tier: "medium",
    instructions:
      "Does `abstract` indicate evaluation on public or widely used benchmarks, datasets, or tasks of its field, whether named or described?",
    criteria: {
      true: "Mentions standard, public, or widely used benchmarks, datasets, or tasks",
      false: "Evaluation is only on self-made, private, or toy data, or no evaluation is described",
    },
  },
  insight: {
    name: "Insight seeker",
    focus: "takeaway",
    tier: "medium",
    bar: 0.8,
    instructions:
      "Does `abstract` state a finding or principle that is useful beyond the specific method it proposes?",
    criteria: {
      true: "Explicitly states an observation, regularity, or principle others could reuse",
      false: "The only takeaway is that the proposed method scores higher",
    },
  },
  clarity: {
    name: "Writing editor",
    focus: "precise summary",
    tier: "medium",
    bar: 0.85,
    instructions:
      "Does `abstract` state the problem, the method, and at least one concrete result, each in specific terms?",
    criteria: {
      true: "Problem, method, and a specific result (a number or a clear comparison) are all present",
      false: "Vague about the method or gives no concrete result",
    },
  },

  // Strict: only strong papers pass.
  r2: {
    name: "Reviewer 2",
    focus: "finds the weakest claim",
    tier: "strict",
    bar: 0.55,
    instructions:
      "Are all claims in `abstract` precise and proportionate to the evidence it describes, with no overclaiming?",
    criteria: {
      true: "Every claim is specific and testable, and matches the scope of the experiments described",
      false: "Uses broad words like law, universal, first, or significantly without matching evidence",
    },
  },
  chair: {
    name: "Top-venue area chair",
    focus: "oral-worthy?",
    tier: "strict",
    instructions:
      "Does `abstract` describe a substantial advance that would likely be selected as an oral or spotlight at a top machine learning venue?",
    criteria: {
      true: "A significant new capability, insight, or result, supported by broad evidence",
      false: "A solid but incremental contribution, or evidence too narrow for a highlight",
    },
  },
  theorist: {
    name: "The Theorist",
    focus: "principled grounding",
    tier: "strict",
    instructions:
      "Does `abstract` provide a formal guarantee, proof, or principled derivation for its method or finding?",
    criteria: {
      true: "Mentions theorems, bounds, guarantees, or a derivation from first principles",
      false: "Purely empirical or heuristic, with no formal grounding",
    },
  },
  skeptic: {
    name: "Benchmark skeptic",
    focus: "are gains real?",
    tier: "strict",
    instructions:
      "Does `abstract` report large and consistent gains over strong recent baselines, quantified with specific numbers?",
    criteria: {
      true: "Specific, sizable improvements over named strong baselines across settings",
      false: "Gains are unquantified, marginal, against weak baselines, or on a single setting",
    },
  },
  scale: {
    name: "Scale tester",
    focus: "holds at scale?",
    tier: "strict",
    instructions:
      "Does `abstract` validate the work at realistic scale, such as large modern models, large real-world datasets, or production settings?",
    criteria: {
      true: "Results on large modern models, large real data, or deployed systems",
      false: "Only small models, toy or synthetic data, or small benchmarks",
    },
  },
} satisfies Record<string, Persona>;

export type PersonaId = keyof typeof PERSONAS;
export const PERSONA_IDS = Object.keys(PERSONAS) as PersonaId[];
export const TIERS: Tier[] = ["lenient", "medium", "strict"];

// The two personas whose takes we show: the most convinced yes and the most convinced no.
export function spokespersons<V extends { fresh: boolean; probability: number }>(verdicts: V[]): V[] {
  const pro = verdicts.filter((v) => v.fresh).sort((a, b) => b.probability - a.probability)[0];
  const con = verdicts.filter((v) => !v.fresh).sort((a, b) => a.probability - b.probability)[0];
  return [pro, con].filter((v): v is V => Boolean(v));
}
