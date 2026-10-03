// Sections (板块) of the site. Jev assigns each paper one area and one type.
export const AREAS: Record<string, { label: string; criteria: string }> = {
  reasoning: { label: "Reasoning", criteria: "LLM reasoning, chain of thought, math or logic ability" },
  memory: { label: "Memory & agents", criteria: "Agent memory, long context, retrieval, tool-using agents" },
  efficiency: { label: "Distillation & efficiency", criteria: "Distillation, compression, efficient training or inference" },
  editing: { label: "Model editing", criteria: "Knowledge editing, unlearning, model repair" },
  graph_ts: { label: "Graphs & time series", criteria: "Graph neural networks, spatial-temporal or time series forecasting" },
  science: { label: "AI for science & health", criteria: "Molecules, proteins, brain imaging, medicine, other sciences" },
  other: { label: "Other", criteria: "None of the above" },
};

export const PAPER_TYPES: Record<string, { label: string; criteria: string }> = {
  method: { label: "Method", criteria: "Proposes a new model, algorithm, or training method" },
  empirical: { label: "Empirical study", criteria: "Analyzes behavior of existing methods without a new method" },
  theory: { label: "Theory", criteria: "Main contribution is proofs or formal analysis" },
  benchmark: { label: "Benchmark", criteria: "Main contribution is a dataset or benchmark" },
  survey: { label: "Survey", criteria: "Reviews existing literature" },
  system: { label: "System", criteria: "Main contribution is software, a toolkit, or infrastructure" },
};
