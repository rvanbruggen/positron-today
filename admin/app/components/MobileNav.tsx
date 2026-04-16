"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
  { href: "/sources",    label: "Sources" },
  { href: "/tags",       label: "Tags" },
  { href: "/fast-track", label: "Fast Track", bold: true, icon: "⚡" },
  { href: "/preview",    label: "Preview" },
  { href: "/scheduled",  label: "Scheduled" },
  { href: "/history",    label: "History" },
  { href: "/rejections", label: "Rejections" },
  { href: "/settings",   label: "Settings" },
];

export default function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      {/* Hamburger button — visible only on small screens */}
      <button
        onClick={() => setOpen(!open)}
        className="md:hidden ml-auto flex flex-col justify-center items-center w-10 h-10 gap-1.5"
        aria-label="Toggle menu"
      >
        <span className={`block w-6 h-0.5 bg-amber-900 transition-transform ${open ? "rotate-45 translate-y-2" : ""}`} />
        <span className={`block w-6 h-0.5 bg-amber-900 transition-opacity ${open ? "opacity-0" : ""}`} />
        <span className={`block w-6 h-0.5 bg-amber-900 transition-transform ${open ? "-rotate-45 -translate-y-2" : ""}`} />
      </button>

      {/* Mobile dropdown menu */}
      {open && (
        <div className="md:hidden absolute top-full left-0 right-0 bg-yellow-400 border-t border-yellow-500 shadow-lg z-50">
          <div className="max-w-screen-2xl mx-auto px-4 py-3 flex flex-col gap-1">
            {NAV_LINKS.map(({ href, label, bold, icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={`px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  pathname === href
                    ? "bg-amber-900 text-yellow-300 font-semibold"
                    : "text-amber-900 hover:bg-yellow-300"
                } ${bold ? "font-semibold" : "font-medium"}`}
              >
                {icon ? `${icon} ${label}` : label}
              </Link>
            ))}
            <a
              href="https://positron.today/"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="px-3 py-2.5 rounded-lg text-sm text-amber-900 hover:bg-yellow-300 font-medium"
            >
              View site ↗
            </a>
          </div>
        </div>
      )}
    </>
  );
}
