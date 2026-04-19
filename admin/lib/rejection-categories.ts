export interface RejectionCategory {
  slug: string;
  label: string;
  emoji: string;
  color: string;        // Tailwind bg class for admin badges
  colorHex: string;     // Hex for public site SVG/CSS
}

export const REJECTION_CATEGORIES: RejectionCategory[] = [
  { slug: "war-conflict",          label: "War & Conflict",             emoji: "⚔️",  color: "bg-red-100 text-red-700 border-red-200",        colorHex: "#fca5a5" },
  { slug: "crime-violence",        label: "Crime & Violence",           emoji: "🔫",  color: "bg-orange-100 text-orange-700 border-orange-200", colorHex: "#fdba74" },
  { slug: "political-conflict",    label: "Political Conflict",         emoji: "🏛️",  color: "bg-purple-100 text-purple-700 border-purple-200", colorHex: "#d8b4fe" },
  { slug: "economic-doom",         label: "Economic Doom",              emoji: "📉",  color: "bg-yellow-100 text-yellow-700 border-yellow-200", colorHex: "#fde047" },
  { slug: "disaster-accident",     label: "Disaster & Accident",        emoji: "🌊",  color: "bg-blue-100 text-blue-700 border-blue-200",       colorHex: "#93c5fd" },
  { slug: "health-scare",          label: "Health Scare",               emoji: "🦠",  color: "bg-green-100 text-green-700 border-green-200",    colorHex: "#86efac" },
  { slug: "divisive-social",       label: "Divisive & Social Tension",  emoji: "⚡",  color: "bg-amber-100 text-amber-700 border-amber-200",    colorHex: "#fcd34d" },
  { slug: "lgbtq-rights",          label: "LGBTQ Rights",               emoji: "🏳️‍🌈", color: "bg-pink-100 text-pink-700 border-pink-200",       colorHex: "#f9a8d4" },
  { slug: "divisive-racism",       label: "Divisive & Racism",          emoji: "✊",  color: "bg-stone-100 text-stone-700 border-stone-200",    colorHex: "#d6d3d1" },
  { slug: "sports-negative",       label: "Sports & Competition",       emoji: "⚽",  color: "bg-lime-100 text-lime-700 border-lime-200",       colorHex: "#bef264" },
  { slug: "celebrity-entertainment",label: "Celebrity & Entertainment",  emoji: "🎬",  color: "bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200", colorHex: "#e879f9" },
  { slug: "tech-ai-concern",       label: "Tech & AI Anxiety",          emoji: "🤖",  color: "bg-cyan-100 text-cyan-700 border-cyan-200",       colorHex: "#67e8f9" },
  { slug: "climate-environment",   label: "Climate & Environment",      emoji: "🌍",  color: "bg-teal-100 text-teal-700 border-teal-200",       colorHex: "#5eead4" },
  { slug: "soft-news-filler",      label: "Soft News & Filler",         emoji: "📰",  color: "bg-slate-100 text-slate-600 border-slate-200",    colorHex: "#cbd5e1" },
  { slug: "other-negative",        label: "Other Negative",             emoji: "😔",  color: "bg-gray-100 text-gray-600 border-gray-200",       colorHex: "#d1d5db" },
  { slug: "human-discarded",       label: "Discarded on Review",        emoji: "🙅",  color: "bg-zinc-100 text-zinc-600 border-zinc-200",       colorHex: "#d4d4d8" },
];

export const CATEGORY_MAP = new Map(REJECTION_CATEGORIES.map(c => [c.slug, c]));

export const CATEGORY_SLUGS = REJECTION_CATEGORIES.map(c => c.slug);

/** The prompt fragment listing all valid category slugs for the AI */
export const CATEGORY_PROMPT_LIST = REJECTION_CATEGORIES
  .map(c => `  "${c.slug}" — ${c.label}`)
  .join("\n");
