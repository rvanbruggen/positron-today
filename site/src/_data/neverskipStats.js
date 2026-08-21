// Figures quoted in the "Necessary Negativity" intro.
//
// Derived from the same rejection export the skip log renders, so the
// percentages in the prose can never drift away from the chart underneath
// them — the intro's whole argument is that these three subjects are a small
// slice of the pile, and a hard-coded number would eventually make that a lie.

const rejections = require("./rejections.json");

// Must stay in step with NEVER_SKIP_THEMES in admin/lib/never-skip-themes.ts.
const THEME_CATEGORIES = [
  "climate-environment",
  "tech-ai-concern",
  "divisive-social",
  "divisive-racism",
  "lgbtq-rights",
];

const COMPARISON_CATEGORY = "political-conflict";

const breakdown = Array.isArray(rejections.category_breakdown)
  ? rejections.category_breakdown
  : [];

const countOf = (slug) => {
  const row = breakdown.find((c) => c.category === slug);
  return row ? Number(row.count) || 0 : 0;
};

const total = Number(rejections.total_rejected) || 0;
const themeTotal = THEME_CATEGORIES.reduce((sum, slug) => sum + countOf(slug), 0);
const comparison = countOf(COMPARISON_CATEGORY);

// One decimal for the small slice (2.9% and 3.5% are meaningfully different),
// whole numbers for the large one where a decimal is just noise.
const pct = (n, digits) => (total > 0 ? ((100 * n) / total).toFixed(digits) : "0");

module.exports = {
  total,
  totalFormatted: total.toLocaleString("en-GB"),
  themeTotal,
  themePct: pct(themeTotal, 1),
  comparisonPct: pct(comparison, 0),
  // "more than three times" — kept as a number so the template can phrase it.
  ratio: themeTotal > 0 ? Math.floor(comparison / themeTotal) : 0,
};
