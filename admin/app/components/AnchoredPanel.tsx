"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A panel pinned to an anchor element, rendered into <body> with fixed
 * positioning. The admin tables sit inside `overflow-x-auto` wrappers, which
 * clip anything absolutely positioned inside them — a portal avoids that.
 *
 * Opens below the anchor (above it when there is no room), right-aligned by
 * default, and kept inside the viewport. Closes on Escape, a click outside,
 * scrolling or resizing.
 */
export default function AnchoredPanel({
  anchor,
  open,
  onClose,
  align = "right",
  width = 288,
  onMouseEnter,
  onMouseLeave,
  children,
}: {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  align?: "left" | "right";
  width?: number;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Positioned by writing to the element directly: the panel has to be in the
  // DOM (hidden) before its height is known, so this runs after mount rather
  // than through state and a second render.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || !anchor || !panel) return;
    const r = anchor.getBoundingClientRect();
    const margin = 8;
    const w = Math.min(width, window.innerWidth - margin * 2);
    let left = align === "right" ? r.right - w : r.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));
    const h = panel.offsetHeight;
    const below = r.bottom + 4;
    const top = below + h > window.innerHeight - margin && r.top - h - 4 > margin ? r.top - h - 4 : below;
    panel.style.width = `${w}px`;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.visibility = "visible";
  }, [open, anchor, align, width]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const onMove = (e: Event) => {
      // Scrolling inside the panel itself is fine.
      if (panelRef.current && e.target instanceof Node && panelRef.current.contains(e.target)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, anchor, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={panelRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ position: "fixed", top: 0, left: 0, width, visibility: "hidden" }}
      className="z-50 bg-white rounded-xl shadow-lg border border-yellow-200 text-left"
    >
      {children}
    </div>,
    document.body,
  );
}
