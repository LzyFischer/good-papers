// Abstracts and titles from arXiv often carry LaTeX ("$\times$", "\textbf{...}", "$O(n^2)$").
// tex() turns the common cases into plain text with Unicode symbols, for display only (the
// stored text stays as the source gave it). Anything it doesn't know loses its backslash and
// braces rather than showing as code.

const SYMBOLS: Record<string, string> = {
  times: "×", cdot: "·", pm: "±", mp: "∓", div: "÷", leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠",
  approx: "≈", sim: "∼", simeq: "≃", equiv: "≡", propto: "∝", infty: "∞", to: "→", rightarrow: "→", leftarrow: "←",
  Rightarrow: "⇒", leftrightarrow: "↔", mapsto: "↦", uparrow: "↑", downarrow: "↓", in: "∈", notin: "∉", subset: "⊂",
  subseteq: "⊆", cup: "∪", cap: "∩", forall: "∀", exists: "∃", partial: "∂", nabla: "∇", sum: "∑", prod: "∏",
  int: "∫", ll: "≪", gg: "≫", circ: "∘", ldots: "…", dots: "…", cdots: "⋯", prime: "′", degree: "°", star: "⋆",
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ",
  iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ",
  upsilon: "υ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ",
  Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω", log: "log", min: "min", max: "max",
  exp: "exp", ie: "i.e.", eg: "e.g.", etal: "et al.", "%": "%", "&": "&", "#": "#", _: "_", "$": "$",
};

const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", n: "ⁿ", i: "ⁱ", T: "ᵀ", k: "ᵏ" };
const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋", i: "ᵢ", j: "ⱼ", k: "ₖ", n: "ₙ", t: "ₜ" };

// x^2, x^{10}, x_i: use Unicode super/subscripts when every character has one.
function scripts(s: string): string {
  const conv = (body: string, map: Record<string, string>, mark: string) =>
    [...body].every((c) => map[c]) ? [...body].map((c) => map[c]).join("") : `${mark}${body}`;
  return s
    .replace(/\^\{([^{}]*)\}|\^(\S)/g, (_, a, b) => conv(a ?? b, SUP, "^"))
    .replace(/_\{([^{}]*)\}|_([A-Za-z0-9])/g, (_, a, b) => conv(a ?? b, SUB, "_"));
}

export function tex(input: string | null | undefined): string {
  if (!input || !/[\\$]/.test(input)) return input ?? "";
  let s = input;
  // Links and citations.
  s = s.replace(/\\href\{([^{}]*)\}\{([^{}]*)\}/g, "$2").replace(/\\url\{([^{}]*)\}/g, "$1");
  s = s.replace(/~?\\cite[pt]?\*?(\[[^\]]*\])?\{[^{}]*\}/g, "");
  // Text styles and wrappers keep their content (repeat for nesting).
  for (let i = 0; i < 3; i++) {
    s = s.replace(
      /\\(?:textbf|textit|emph|textsc|texttt|textsf|textrm|text|mathrm|mathbf|mathit|mathsf|mathtt|mathcal|mathbb|boldsymbol|operatorname|underline|overline|widetilde|tilde|hat|bar|vec|mbox|textnormal)\s*\{([^{}]*)\}/g,
      "$1",
    );
  }
  s = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "$1/$2").replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)");
  s = s.replace(/\\(left|right|big|Big|bigg|Bigg)(?![a-zA-Z])/g, "");
  // Named symbols, then any other command: drop the backslash (custom macros like \Ours).
  s = s.replace(/\\([a-zA-Z]+|[%&#_$])/g, (m, name) => SYMBOLS[name] ?? name);
  // Math mode: unwrap $...$ and $$...$$, applying super/subscripts inside.
  s = s.replace(/\$\$([^$]+)\$\$|\$([^$]+)\$/g, (_, a, b) => scripts(a ?? b));
  // Leftover grouping braces, LaTeX quotes and non-breaking spaces.
  s = s.replace(/[{}]/g, "").replace(/``/g, "“").replace(/''/g, "”").replace(/(\w)~(\w)/g, "$1 $2");
  return s.replace(/[ \t]{2,}/g, " ").trim();
}
