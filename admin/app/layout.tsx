import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
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
      <body className={`${geist.className} bg-amber-50 min-h-screen`}>
        <nav className="bg-yellow-400 shadow-sm">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-6">
            <Link href="/" className="text-xl font-bold text-amber-900 tracking-tight">
              ✨ Positiviteiten
            </Link>
            <span className="text-amber-700 text-sm font-medium">admin</span>
            <div className="flex gap-5 ml-6 text-sm font-medium text-amber-900">
              <Link href="/sources" className="hover:text-amber-600 transition-colors">Sources</Link>
              <Link href="/topics" className="hover:text-amber-600 transition-colors">Topics</Link>
              <Link href="/preview" className="hover:text-amber-600 transition-colors">Preview</Link>
              <Link href="/scheduled" className="hover:text-amber-600 transition-colors">Scheduled</Link>
              <Link href="/history" className="hover:text-amber-600 transition-colors">History</Link>
            </div>
          </div>
        </nav>
        <main className="max-w-5xl mx-auto px-4 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
