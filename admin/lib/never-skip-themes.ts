/**
 * Themes for the "Necessary Negativity" section.
 *
 * Each theme groups one or more rejection categories. These are the three
 * subjects the editorial "The negativity we actually need" identified as
 * structurally consequential but crowded out by higher-volume negativity —
 * together they are roughly 7.5% of everything the filter rejects, against
 * 27% for political conflict alone.
 *
 * Labels live here rather than in the Nunjucks template because the weekly
 * generator needs them too (they go into the prompt so the model knows which
 * subject it is ranking for).
 */

export interface NeverSkipTheme {
  /** Stable key — used in neverskip.json and must not change once published. */
  key: string;
  emoji: string;
  /** Rejection category slugs that feed this theme. */
  categories: string[];
  label_en: string;
  label_nl: string;
  label_fr: string;
  /** Hex used for the theme accent on the public site. */
  colorHex: string;
}

export const NEVER_SKIP_THEMES: NeverSkipTheme[] = [
  {
    key: "climate",
    emoji: "🌍",
    categories: ["climate-environment"],
    label_en: "Climate & Environment",
    label_nl: "Klimaat & Milieu",
    label_fr: "Climat & Environnement",
    colorHex: "#5eead4",
  },
  {
    key: "tech",
    emoji: "🤖",
    categories: ["tech-ai-concern"],
    label_en: "Technology & AI",
    label_nl: "Technologie & AI",
    label_fr: "Technologie & IA",
    colorHex: "#67e8f9",
  },
  {
    key: "social",
    emoji: "⚡",
    categories: ["divisive-social", "divisive-racism", "lgbtq-rights"],
    label_en: "Division & Social Tension",
    label_nl: "Verdeeldheid & Sociale spanning",
    label_fr: "Division & Tensions sociales",
    colorHex: "#fcd34d",
  },
];

export const NEVER_SKIP_CATEGORIES = NEVER_SKIP_THEMES.flatMap((t) => t.categories);

export const THEME_MAP = new Map(NEVER_SKIP_THEMES.map((t) => [t.key, t]));
