// The AI panel: 20 reviewers (21 when a paper has a real citation record, see
// citationRecord in judge.ts), each one Jev "noul" (yes/no) question about the
// paper: its title, abstract, and, when lib/fulltext.ts finds the full text,
// its introduction and conclusion. Jev reads questions literally and has no notion
// of role-play, so a persona's identity lives entirely in the concrete
// condition it checks. Personas differ in what they value and in how strict
// that condition is (tier), so good papers rarely get 20/20 and weak ones
// rarely 0/20. A yes probability of at least `bar` (default 0.5) counts as
// "fresh". Jev's wording alone is close to all-or-nothing, so bars were set
// from the probabilities on ~70 papers (recent arXiv ML plus a few classics),
// judged with full text, to put lenient ≈ 80%, medium ≈ 50%, strict ≈ 10-20%
// of papers at fresh. Reading full text shifts probabilities (Reviewer 2 gets
// harsher, the evidence checks more lenient), so re-calibrate if that changes.
// Most personas ask about significance rather than abstract checklists
// (code, efficiency, baselines), which unfairly sank analysis papers.
// Re-calibrate after editing a persona.
// Edit freely: these strings are the whole persona definition.

export type Tier = "lenient" | "medium" | "strict";

type Persona = {
  name: string;
  focus: string;
  tier: Tier;
  bar?: number; // yes probability needed for "fresh"; default 0.5, never below it
  needsCitations?: boolean; // only asked when the paper is old enough for citations to mean something
  instructions: string;
  criteria: { true: string; false: string };
};

export const PERSONAS = {
  // Lenient: most competent papers pass.
  student: {
    name: "First-year PhD student",
    focus: "is it interesting?",
    tier: "lenient",
    bar: 0.8,
    instructions:
      "Does the paper describe an idea that a first-year machine learning PhD student would find interesting and could follow?",
    criteria: {
      true: "The problem and idea are understandable and spark curiosity",
      false: "The idea is impenetrable, trivial, or the abstract never says what was done",
    },
  },
  generalist: {
    name: "The Generalist",
    focus: "clarity and reach",
    tier: "lenient",
    bar: 0.6,
    instructions:
      "Would a machine learning researcher outside this subfield understand from the paper what problem is solved and why it matters?",
    criteria: {
      true: "States the problem, the approach, and the payoff in plain terms",
      false: "Relies on subfield jargon or never says why the problem matters",
    },
  },
  teacher: {
    name: "Course instructor",
    focus: "worth teaching?",
    tier: "lenient",
    bar: 0.78,
    instructions:
      "Does the paper contain a concept, finding, or technique general enough to be worth mentioning in a graduate machine learning course?",
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
      "Does the paper connect its work to a concrete real-world problem, application domain, or user need?",
    criteria: {
      true: "Names a real application, domain, or practical need the work serves",
      false: "Purely abstract benchmark chasing with no stated real-world motivation",
    },
  },
  trend: {
    name: "Trend watcher",
    focus: "timely topic",
    tier: "lenient",
    bar: 0.88,
    instructions:
      "Does the paper address a question that the machine learning community is actively working on right now?",
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
    bar: 0.8,
    instructions:
      "Does the paper describe an evaluation broad enough to support its main claim, such as several datasets, models, or settings with comparisons to existing methods?",
    criteria: {
      true: "Experiments span more than one model, dataset, or setting and are compared against baselines",
      false: "Evaluation is a single model or dataset, synthetic only, or not described",
    },
  },
  novelty: {
    name: "The Novelty Hunter",
    focus: "is the idea new?",
    tier: "medium",
    bar: 0.75,
    instructions:
      "Does the paper introduce a new problem setting, finding, or technique that goes beyond a straightforward variant of existing methods?",
    criteria: {
      true: "A new setting, a new finding, or a technique with a clearly different core idea from prior work",
      false: "A routine variant or combination of known components, or a known method applied to new data",
    },
  },
  prac: {
    name: "The Practitioner",
    focus: "can I use it?",
    tier: "medium",
    bar: 0.57,
    instructions:
      "Could practitioners act on the result described in the paper, for example through released code or tools, a method that plugs into existing systems, or concrete guidance they can follow?",
    criteria: {
      true: "Offers code, a drop-in method, a tool, or actionable guidance for people building or deploying systems",
      false: "Nothing a practitioner could use or act on, or it needs infrastructure few have",
    },
  },
  motivation: {
    name: "Motivation critic",
    focus: "why is this needed?",
    tier: "medium",
    bar: 0.94,
    instructions:
      "Does the paper name a specific limitation of prior methods, beyond saying the topic matters, and design its approach around that limitation?",
    criteria: {
      true: "A concrete shortcoming of existing methods is named and the approach is built to fix it",
      false: "Motivation is generic ('X is important'), or the stated gap is unrelated to what the method does",
    },
  },
  ablation: {
    name: "Ablation fan",
    focus: "why does it work?",
    tier: "medium",
    bar: 0.68,
    instructions:
      "Does the paper go beyond headline results to explain what drives them, for example through ablations, controlled comparisons, diagnostic analysis, or a mechanism?",
    criteria: {
      true: "Describes analysis that isolates causes or explains a mechanism behind the results",
      false: "Reports only outcomes, with no analysis of what drives them",
    },
  },
  stakes: {
    name: "Question weigher",
    focus: "does the question matter?",
    tier: "medium",
    bar: 0.85,
    instructions:
      "Does the paper address a question whose answer matters a lot for its field, such as a widely held assumption, a major risk, or a central capability?",
    criteria: {
      true: "The question is central to the field or to how AI affects people, not a side detail",
      false: "A narrow or incremental question that few researchers depend on",
    },
  },
  shift: {
    name: "Agenda setter",
    focus: "changes what we do next?",
    tier: "medium",
    bar: 0.78,
    instructions:
      "Would the findings in the paper, if they hold, change what researchers in this area build, measure, or believe?",
    criteria: {
      true: "Suggests a new direction, a new way to evaluate, or overturns a common practice",
      false: "Adds a data point but leaves the field's practice unchanged",
    },
  },
  benchmarks: {
    name: "Domain expert",
    focus: "standard benchmarks",
    tier: "medium",
    bar: 0.74,
    instructions:
      "Does the paper indicate evaluation on public or widely used benchmarks, datasets, or tasks of its field, whether named or described?",
    criteria: {
      true: "Mentions standard, public, or widely used benchmarks, datasets, or tasks",
      false: "Evaluation is only on self-made, private, or toy data, or no evaluation is described",
    },
  },
  insight: {
    name: "Insight seeker",
    focus: "takeaway",
    tier: "medium",
    bar: 0.85,
    instructions:
      "Does the paper state a finding or principle that is useful beyond the specific method it proposes?",
    criteria: {
      true: "Explicitly states an observation, regularity, or principle others could reuse",
      false: "The only takeaway is that the proposed method scores higher",
    },
  },
  impact: {
    name: "Citation tracker",
    focus: "community uptake",
    tier: "medium",
    needsCitations: true,
    instructions:
      "Does `citations` show that the research community has picked this paper up, with more citations than is typical for a paper of its age?",
    criteria: {
      true: "Roughly 20 or more citations per year since publication, or several hundred in total",
      false: "Few citations for the time it has been out",
    },
  },
  clarity: {
    name: "Writing editor",
    focus: "precise summary",
    tier: "medium",
    bar: 0.94,
    instructions:
      "Does the paper state the problem, the method, and at least one concrete result, each in specific terms?",
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
    instructions:
      "Are all claims in the paper precise and proportionate to the evidence it describes, with no overclaiming?",
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
      "Does the paper describe a substantial advance that would likely be selected as an oral or spotlight at a top machine learning venue?",
    criteria: {
      true: "A significant new capability, insight, or result, supported by broad evidence",
      false: "A solid but incremental contribution, or evidence too narrow for a highlight",
    },
  },
  surprise: {
    name: "Surprise detector",
    focus: "did I expect that?",
    tier: "strict",
    bar: 0.55,
    instructions:
      "Does the paper report a result that most researchers in the field would not have predicted, or that contradicts a common belief?",
    criteria: {
      true: "A counterintuitive finding or a result that overturns a common assumption",
      false: "Results are what one would expect, e.g. a new method improving a benchmark",
    },
  },
  skeptic: {
    name: "Evidence skeptic",
    focus: "is the evidence strong?",
    tier: "strict",
    bar: 0.8,
    instructions:
      "Does the paper support its main conclusion with strong evidence, such as sizable effects across several models, datasets, or settings, or a formal proof?",
    criteria: {
      true: "Large, consistent effects across settings, or a proof, rather than a single favorable result",
      false: "Effects are marginal, unquantified, or shown in one setting only",
    },
  },
  landmark: {
    name: "Future citer",
    focus: "will this be a standard reference?",
    tier: "strict",
    instructions:
      "Is the work in the paper likely to become a standard reference that later papers routinely cite, such as a widely adopted method, benchmark, dataset, or finding?",
    criteria: {
      true: "Likely to be reused or cited as the reference for its idea, benchmark, or finding",
      false: "Likely to be one of many similar papers on the topic",
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
