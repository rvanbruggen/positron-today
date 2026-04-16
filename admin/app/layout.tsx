import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import { APP_VERSION } from "@/lib/version";
import { getSettings } from "@/lib/settings";
import "./globals.css";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Positron Today - Admin",
  description: "Admin panel for the Positron Today positive news site",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let positronitronActive = false;
  try {
    const settings = await getSettings();
    positronitronActive = settings.positronitron_enabled === "true";
  } catch { /* settings table may not exist yet */ }
  return (
    <html lang="en">
      <body className={`${geist.className} bg-amber-50 min-h-screen flex flex-col`}>
        <nav className="bg-yellow-400 shadow-sm">
          <div className="max-w-screen-2xl mx-auto px-4 py-3 flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2 text-xl font-bold text-amber-900 tracking-tight">
              {/* Positron atom icon: three orbitals + nucleus with + */}
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="32" height="32" aria-hidden="true">
                <ellipse cx="50" cy="50" rx="46" ry="16" fill="none" stroke="#f59e0b" strokeWidth="5"/>
                <ellipse cx="50" cy="50" rx="46" ry="16" fill="none" stroke="#f59e0b" strokeWidth="5" transform="rotate(60 50 50)"/>
                <ellipse cx="50" cy="50" rx="46" ry="16" fill="none" stroke="#f59e0b" strokeWidth="5" transform="rotate(120 50 50)"/>
                <circle cx="50" cy="50" r="13" fill="#f59e0b"/>
                <rect x="43.5" y="47" width="13" height="6" rx="2" fill="white" opacity="0.95"/>
                <rect x="47" y="43.5" width="6" height="13" rx="2" fill="white" opacity="0.95"/>
              </svg>
              Positron Today
            </Link>
            <span className="text-amber-700 text-sm font-medium">admin</span>
            <div className="flex gap-5 ml-6 text-sm font-medium text-amber-900">
              <Link href="/sources" className="hover:text-amber-600 transition-colors">Sources</Link>
              <Link href="/tags" className="hover:text-amber-600 transition-colors">Tags</Link>
              <Link href="/fast-track" className="hover:text-amber-600 transition-colors font-semibold">⚡ Fast Track</Link>
              <Link href="/preview" className="hover:text-amber-600 transition-colors">Preview</Link>
              <Link href="/scheduled" className="hover:text-amber-600 transition-colors">Scheduled</Link>
              <Link href="/history" className="hover:text-amber-600 transition-colors">History</Link>
              <Link href="/rejections" className="hover:text-amber-600 transition-colors">Rejections</Link>
              <Link href="/settings" className="hover:text-amber-600 transition-colors">Settings</Link>
            </div>
            <div className="ml-auto flex items-center gap-3">
              {positronitronActive && (
                <Link href="/settings" className="text-xs bg-green-500 text-white px-2.5 py-1 rounded-full font-bold animate-pulse" title="Positronitron is active — click to manage">
                  ⚡ AUTO
                </Link>
              )}
              <span className="text-xs text-amber-700 font-mono">v{APP_VERSION}</span>
              <a
                href="https://positron.today/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs bg-amber-900 text-yellow-300 px-3 py-1.5 rounded-lg hover:bg-amber-800 transition-colors font-medium"
              >
                View site ↗
              </a>
            </div>
          </div>
        </nav>
        <main className="max-w-screen-2xl mx-auto px-4 py-8 flex-1 w-full">
          {children}
        </main>
        <footer className="max-w-screen-2xl mx-auto w-full px-4 py-4 text-center text-xs text-amber-500">
          Positron Today admin · v{APP_VERSION}
        </footer>
      </body>
    </html>
  );
}
