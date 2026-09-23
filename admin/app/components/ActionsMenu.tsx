"use client";

import { useCallback, useState, type ReactNode } from "react";
import AnchoredPanel from "./AnchoredPanel";

export type MenuItem = {
  key: string;
  icon: ReactNode;
  label: string;
  /** Secondary line under the label, e.g. "Posted 14 Aug 2026". */
  hint?: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Draw a divider above this item. */
  separated?: boolean;
};

/** A compact "Actions ▾" button that opens a menu of row actions. */
export default function ActionsMenu({
  items,
  busy = false,
  done = false,
}: {
  items: MenuItem[];
  /** Show a spinner on the button while one of the actions is running. */
  busy?: boolean;
  /** Briefly show a tick after an action completed. */
  done?: boolean;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Actions"
        className="inline-flex items-center gap-1 px-2 h-7 rounded bg-amber-100 hover:bg-amber-200 text-amber-800 text-xs font-medium transition-colors whitespace-nowrap"
      >
        {busy ? "⏳" : done ? "✓" : null}
        {/* Just the arrow on phones, where the table is already tight. */}
        <span className="hidden sm:inline">Actions</span>
        <span aria-hidden className="text-[10px]">▾</span>
      </button>
      <AnchoredPanel anchor={anchor} open={open} onClose={close} width={250}>
        <ul role="menu" className="py-1">
          {items.map((item) => (
            <li key={item.key} role="none" className={item.separated ? "border-t border-yellow-100 mt-1 pt-1" : ""}>
              <button
                role="menuitem"
                type="button"
                disabled={item.disabled}
                onClick={() => { setOpen(false); item.onSelect(); }}
                className={`w-full flex items-start gap-2.5 px-3 py-1.5 text-left text-sm transition-colors disabled:opacity-40 disabled:cursor-default ${
                  item.danger ? "text-red-600 hover:bg-red-50" : "text-amber-900 hover:bg-amber-50"
                }`}
              >
                <span aria-hidden className="w-4 shrink-0 text-center leading-5">{item.icon}</span>
                <span className="min-w-0">
                  <span className="block leading-5">{item.label}</span>
                  {item.hint && <span className="block text-[11px] text-amber-500 leading-tight">{item.hint}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </AnchoredPanel>
    </>
  );
}
