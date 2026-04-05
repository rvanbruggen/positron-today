import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import { APP_VERSION } from "@/lib/version";
import "./globals.css";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Positiviteiten - Admin",
  description: "Admin panel for the Positiviteiten positive news site",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${geist.className} bg-amber-50 min-h-screen flex flex-col`}>
        <nav className="bg-yellow-400 shadow-sm">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-6">
            <Link href="/" className="text-xl font-bold text-amber-900 tracking-tight">
              ✨ Positiviteiten
            </Link>
            <span className="text-amber-700 text-sm font-medium">admin</span>
            <div className="flex gap-5 ml-6 text-sm font-medium text-amber-900">
              <Link href="/sources" className="hover:text-amber-600 transition-colors">Sources</Link>
              <Link href="/tags" className="hover:text-amber-600 transition-colors">Tags</Link>
              <Link href="/preview" className="hover:text-amber-600 transition-colors">Preview</Link>
              <Link href="/scheduled" className="hover:text-amber-600 transition-colors">Scheduled</Link>
              <Link href="/history" className="hover:text-amber-600 transition-colors">History</Link>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <span className="text-xs text-amber-700 font-mono">v{APP_VERSION}</span>
              <a
                href="https://rvanbruggen.github.io/positiviteiten/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs bg-amber-900 text-yellow-300 px-3 py-1.5 rounded-lg hover:bg-amber-800 transition-colors font-medium"
              >
                View site ↗
              </a>
            </div>
          </div>
        </nav>
        <main className="max-w-5xl mx-auto px-4 py-8 flex-1 w-full">
          {children}
        </main>
        <footer className="max-w-5xl mx-auto w-full px-4 py-4 text-center text-xs text-amber-500">
          Positiviteiten admin · v{APP_VERSION}
        </footer>
      </body>
    </html>
  );
}
