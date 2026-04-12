"use client";

import { useState, useRef } from "react";

type LogEntry =
  | { kind: "info";    text: string }
  | { kind: "pass";    text: string }
  | { kind: "reject";  text: string }
  | { kind: "publish"; text: string }
  | { kind: "error";   text: string }
  | { kind: "dim";     text: string };

interface Stats {
  passed: number;
  filtered: number;
  skipped: number;
  published: number;
  errors: number;
}

export default function FastTrackPage() {
  const [running, setRunning]     = useState(false);
  const [done, setDone]           = useState(false);
  const [log, setLog]             = useState<LogEntry[]>([]);
  const [stats, setStats]         = useState<Stats | null>(null);
  const [currentMode, setCurrentMode] = useState<"publish" | "schedule">("publish");
  const [intervalMinutes, setIntervalMinutes] = useState(30);
  const logRef                    = useRef<HTMLDivElement>(null);
  const abortRef                  = useRef<AbortController | null>(null);

  const append = (entry: LogEntry) => {
    setLog((prev) => [...prev, entry]);
    // Scroll to bottom
    requestAnimationFrame(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    });
  };

  async function runFastTrack(mode: "publish" | "schedule") {
    setRunning(true);
    setCurrentMode(mode);
    setDone(false);
    setLog([]);
    setStats(null);

    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/fast-track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, interval_minutes: intervalMinutes }),
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) {
        append({ kind: "error", text: `Server error: ${res.status}` });
        setRunning(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);
            handleEvent(evt);
          } catch {
            append({ kind: "dim", text: line });
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        append({ kind: "error", text: String(err) });
      }
    }

    setRunning(false);
    setDone(true);
  }

  function handleEvent(evt: Record<string, unknown>) {
    switch (evt.type) {
      case "start":
        append({ kind: "info", text: `⚡ Fast-track (${evt.mode === "schedule" ? "schedule mode" : "publish now"}) — scanning ${evt.totalSources} sources with maximum strictness (threshold 10)` });
        break;

      case "source":
        append({ kind: "dim", text: `\n📡 ${evt.name}` });
        break;

      case "article":
        switch (evt.verdict) {
          case "filtered":
            append({ kind: "reject", text: `  ✕ [filtered] ${evt.title}` });
            break;
          case "passed":
            append({ kind: "pass", text: `  ✓ [passed]   ${evt.title}` });
            break;
          case "summarising":
            append({ kind: "dim", text: `  ⋯ [summarising] ${evt.title}` });
            break;
          case "publishing":
            append({ kind: "dim", text: `  ⋯ [publishing]  ${evt.title}` });
            break;
          case "published":
            append({ kind: "publish", text: `  🚀 [published]  ${evt.title}` });
            break;
          case "scheduled":
            append({ kind: "publish", text: `  📅 [scheduled]  ${evt.title}  →  ${evt.publish_date}` });
            break;
          case "error":
            append({ kind: "error", text: `  ⚠ [error @ ${evt.step}] ${evt.title}: ${evt.message}` });
            break;
        }
        break;

      case "source_done":
        append({
          kind: "dim",
          text: `   → passed ${evt.passed} · filtered ${evt.filtered} · skipped ${evt.skipped} · published ${evt.published}${Number(evt.errors) > 0 ? ` · errors ${evt.errors}` : ""}`,
        });
        break;

      case "source_error":
        append({ kind: "error", text: `⚠ Source error (${evt.name}): ${evt.message}` });
        break;

      case "done": {
        const isSchedule = evt.mode === "schedule";
        setStats({
          passed:    Number(evt.passed),
          filtered:  Number(evt.filtered),
          skipped:   Number(evt.skipped),
          published: Number(evt.published),
          errors:    Number(evt.errors),
        });
        const action = isSchedule ? "scheduled" : "published";
        append({ kind: "info", text: `\n✅ Done! ${evt.published} article(s) ${action} · ${evt.passed} passed filter · ${evt.filtered} filtered · ${evt.skipped} already known${isSchedule ? " — check the Scheduled page to review" : ""}` });
        break;
      }

      case "exporting":
        append({ kind: "dim", text: "  ⋯ Exporting rejection log…" });
        break;

      case "exported":
        append({ kind: "dim", text: `  ✓ Rejection log exported (${evt.count} entries)` });
        break;

      case "export_error":
        append({ kind: "error", text: `  ⚠ Export error: ${evt.message}` });
        break;

      case "fatal":
        append({ kind: "error", text: `💥 Fatal error: ${evt.message}` });
        break;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-amber-900 mb-1">⚡ Fast Track</h1>
      <p className="text-amber-700 text-sm mb-6">
        One-click pipeline: fetch → filter (maximum strictness) → summarise → publish.
        Only articles that pass the strictest positivity threshold (10/10) will be
        published automatically.
      </p>

      {/* Warning box */}
      <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 mb-6 text-sm text-amber-800">
        <p className="font-semibold mb-1">⚠️ Fully automated — no manual review</p>
        <p>
          Fast Track skips the review step entirely. Every article that passes the AI
          positivity filter will be summarised, then either published immediately or added
          to the Scheduled queue with staggered times.
        </p>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3 items-center mb-6">
        {!running ? (
          <>
            <button
              onClick={() => runFastTrack("publish")}
              className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl shadow transition-colors"
            >
              ⚡ Publish now
            </button>
            <div className="flex items-center gap-2 bg-white border border-yellow-200 rounded-xl px-4 py-2.5 shadow-sm">
              <span className="text-sm font-semibold text-amber-800">📅 Schedule every</span>
              <select
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(Number(e.target.value))}
                className="text-sm text-amber-800 border border-yellow-200 rounded-lg px-2 py-1 bg-amber-50 focus:outline-none focus:border-yellow-400"
              >
                {[15, 30, 45, 60, 90, 120].map((m) => (
                  <option key={m} value={m}>{m} min</option>
                ))}
              </select>
              <button
                onClick={() => runFastTrack("schedule")}
                className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white font-semibold rounded-lg shadow-sm transition-colors text-sm"
              >
                Schedule →
              </button>
            </div>
          </>
        ) : (
          <button
            onClick={stop}
            className="px-6 py-3 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl shadow transition-colors"
          >
            ✕ Stop
          </button>
        )}

        {done && (
          <button
            onClick={() => { setLog([]); setStats(null); setDone(false); }}
            className="px-6 py-3 bg-white border border-amber-300 text-amber-700 font-semibold rounded-xl shadow-sm hover:bg-amber-50 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Summary stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          {[
            { label: currentMode === "schedule" ? "Scheduled" : "Published", value: stats.published, color: "text-green-700 bg-green-50 border-green-200" },
            { label: "Passed",      value: stats.passed,    color: "text-sky-700 bg-sky-50 border-sky-200" },
            { label: "Filtered",    value: stats.filtered,  color: "text-red-700 bg-red-50 border-red-200" },
            { label: "Already known", value: stats.skipped, color: "text-gray-600 bg-gray-50 border-gray-200" },
            { label: "Errors",      value: stats.errors,    color: "text-orange-700 bg-orange-50 border-orange-200" },
          ].map((s) => (
            <div key={s.label} className={`rounded-xl border p-4 text-center ${s.color}`}>
              <div className="text-2xl font-bold">{s.value}</div>
              <div className="text-xs mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Progress log */}
      {log.length > 0 && (
        <div
          ref={logRef}
          className="bg-gray-950 text-gray-100 rounded-xl p-4 font-mono text-xs leading-relaxed overflow-y-auto max-h-[60vh] whitespace-pre-wrap"
        >
          {log.map((entry, i) => {
            const cls =
              entry.kind === "pass"    ? "text-green-400"  :
              entry.kind === "reject"  ? "text-red-400"    :
              entry.kind === "publish" ? "text-sky-400 font-semibold" :
              entry.kind === "error"   ? "text-orange-400" :
              entry.kind === "info"    ? "text-yellow-300 font-semibold" :
              "text-gray-400";
            return (
              <div key={i} className={cls}>
                {entry.text}
              </div>
            );
          })}
          {running && (
            <div className="text-yellow-400 animate-pulse mt-1">● running…</div>
          )}
        </div>
      )}
    </div>
  );
}
