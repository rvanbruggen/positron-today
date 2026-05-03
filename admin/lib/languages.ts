/**
 * Languages that can be assigned to a source.
 *
 * Three of these (en, nl, fr) are also the public-site output languages —
 * every published article gets a title + summary in those three. The rest
 * (auto, plus the European languages below) are INPUT-ONLY: when an article
 * comes in from a source tagged with one of them, the summarise step still
 * produces output in en/nl/fr.
 *
 * "auto" is a sentinel for "I don't know / don't care" — treated identically
 * to a non-en/nl/fr language for dedup-skipping and English-preview purposes.
 */

export const NATIVE_OUTPUT_LANGUAGES = ["en", "nl", "fr"] as const;

export type SourceLanguage = string;

// Auto-detect pinned at the top; the rest sorted alphabetically by label.
export const SOURCE_LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "auto", label: "Auto-detect" },
  { value: "cs",   label: "Czech (CS)" },
  { value: "da",   label: "Danish (DA)" },
  { value: "nl",   label: "Dutch (NL)" },
  { value: "en",   label: "English (EN)" },
  { value: "fi",   label: "Finnish (FI)" },
  { value: "fr",   label: "French (FR)" },
  { value: "de",   label: "German (DE)" },
  { value: "el",   label: "Greek (EL)" },
  { value: "hu",   label: "Hungarian (HU)" },
  { value: "it",   label: "Italian (IT)" },
  { value: "no",   label: "Norwegian (NO)" },
  { value: "pl",   label: "Polish (PL)" },
  { value: "pt",   label: "Portuguese (PT)" },
  { value: "ro",   label: "Romanian (RO)" },
  { value: "es",   label: "Spanish (ES)" },
  { value: "sv",   label: "Swedish (SV)" },
];

/** True if the source language matches one of the public-site output languages. */
export function isNativeOutputLanguage(lang: string | null | undefined): boolean {
  return !!lang && (NATIVE_OUTPUT_LANGUAGES as readonly string[]).includes(lang);
}

/** Human-readable name for a language code, used in prompts. */
export function languageLabel(code: string): string {
  const found = SOURCE_LANGUAGE_OPTIONS.find(o => o.value === code);
  return found?.label ?? code;
}
