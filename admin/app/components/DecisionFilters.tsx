"use client";

import { NOT_LOGGED, prettyModel } from "@/lib/decision-types";

/** Model and prompt-version dropdowns for filtering a table by decision trail. */
export default function DecisionFilters({
  models,
  prompts,
  model,
  prompt,
  onModel,
  onPrompt,
}: {
  models: string[];
  prompts: string[];
  model: string;
  prompt: string;
  onModel: (v: string) => void;
  onPrompt: (v: string) => void;
}) {
  const select = "border border-yellow-200 rounded-lg px-3 py-1.5 text-sm text-amber-900 focus:outline-none focus:border-yellow-400 bg-white";
  return (
    <>
      <div className="flex items-center gap-2">
        <label className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Model</label>
        <select value={model} onChange={(e) => onModel(e.target.value)} className={select}>
          <option value="all">All models</option>
          {models.map((m) => <option key={m} value={m}>{prettyModel(m)}</option>)}
          <option value={NOT_LOGGED}>Not logged</option>
        </select>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Prompt</label>
        <select value={prompt} onChange={(e) => onPrompt(e.target.value)} className={select}>
          <option value="all">All versions</option>
          {prompts.map((p) => (
            <option key={p} value={p}>{p} ({p.startsWith("P") ? "filter" : "summarise"})</option>
          ))}
          <option value={NOT_LOGGED}>Not logged</option>
        </select>
      </div>
    </>
  );
}
