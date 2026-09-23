"use client";

import { useCallback, useRef, useState } from "react";
import AnchoredPanel from "./AnchoredPanel";
import { formatRejectionTimestamp } from "@/lib/schedule-time";
import { CATEGORY_MAP } from "@/lib/rejection-categories";
import {
  LOG_STARTED, stepChip, stepDetail,
  type PromptVersionInfo, type StepTone, type TrailStep,
} from "@/lib/decision-types";

const TONE: Record<StepTone, string> = {
  accept:  "bg-green-50 text-green-700 border-green-200",
  reject:  "bg-red-50 text-red-600 border-red-200",
  neutral: "bg-amber-50 text-amber-700 border-yellow-200",
};

/**
 * The decision trail for one article: a compact row of chips (who decided,
 * with which model and prompt version), and the full log on hover or tap.
 */
export default function DecisionTrail({
  steps,
  prompts,
}: {
  steps: TrailStep[] | undefined;
  prompts: PromptVersionInfo[];
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const keepOpen = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  }, []);
  const closeSoon = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  }, []);
  const close = useCallback(() => setOpen(false), []);

  if (!steps || steps.length === 0) {
    return (
      <span className="text-xs text-amber-300" title={`Decided before the decision log started in ${LOG_STARTED}`}>
        — not logged
      </span>
    );
  }

  const usedPrompts = [...new Set(steps.map((s) => s.prompt).filter(Boolean))]
    .map((label) => prompts.find((p) => p.label === label))
    .filter((p): p is PromptVersionInfo => !!p);

  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        onMouseEnter={keepOpen}
        onMouseLeave={closeSoon}
        // Opens only: a tap on touch screens also fires mouseenter first, so a
        // toggle would close it again at once. A tap elsewhere closes it.
        onClick={keepOpen}
        aria-expanded={open}
        aria-label="Decision history"
        className="flex flex-wrap items-center gap-0.5 text-left cursor-help"
      >
        {steps.map((s, i) => {
          const chip = stepChip(s);
          return (
            <span key={i} className="inline-flex items-center gap-0.5">
              {i > 0 && <span className="text-amber-300 text-[10px] px-0.5">→</span>}
              <span className={`inline-flex items-center gap-1 md:whitespace-nowrap break-all text-[11px] px-1.5 py-0.5 rounded border ${TONE[chip.tone]}`}>
                <span aria-hidden>{chip.icon}</span>{chip.text}
              </span>
            </span>
          );
        })}
      </button>

      <AnchoredPanel
        anchor={anchor}
        open={open}
        onClose={close}
        onMouseEnter={keepOpen}
        onMouseLeave={closeSoon}
        width={360}
      >
        <div className="px-4 py-3 max-h-80 overflow-y-auto">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">Decision history</p>
          <ol className="flex flex-col gap-2.5">
            {steps.map((s, i) => {
              const chip = stepChip(s);
              const cat = s.category ? CATEGORY_MAP.get(s.category) : undefined;
              return (
                <li key={i} className="text-xs text-amber-900">
                  <div className="flex items-baseline gap-1.5">
                    <span aria-hidden>{chip.icon}</span>
                    <span className="font-medium">{stepDetail(s)}</span>
                  </div>
                  {s.reason && <p className="text-amber-700 italic mt-0.5 ml-5">“{s.reason}”</p>}
                  {s.category && (
                    <p className="text-amber-600 mt-0.5 ml-5">{cat ? `${cat.emoji} ${cat.label}` : s.category}</p>
                  )}
                  <p className="text-[10px] text-amber-400 mt-0.5 ml-5">
                    {formatRejectionTimestamp(s.at)}{s.appVersion ? ` · v${s.appVersion}` : ""}
                  </p>
                </li>
              );
            })}
          </ol>
          {usedPrompts.length > 0 && (
            <div className="mt-3 pt-2 border-t border-yellow-100 text-[10px] text-amber-500">
              {usedPrompts.map((p) => (
                <div key={p.label}>
                  {p.label} = {p.kind === "filter" ? "filter prompt" : "summarise style"} version, first used {formatRejectionTimestamp(p.firstSeen)}
                </div>
              ))}
            </div>
          )}
        </div>
      </AnchoredPanel>
    </>
  );
}
