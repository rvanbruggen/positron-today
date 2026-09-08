/**
 * Compare-and-swap run lock, shared by the scheduled jobs.
 *
 * Several of the automated jobs are read-then-write: check whether the work is
 * already done, and if not, do it and commit. With nothing guarding the gap,
 * two runs that start while the first is still working both see "not done" and
 * both commit. Necessary Negativity hit this on its first live run (three
 * selections for 2026-W33 in ninety seconds, v4.0.4); Positronitron hit it the
 * same morning, publishing the same two articles twice within five seconds.
 *
 * The lock is a compare-and-swap on a single settings row: only one concurrent
 * UPDATE can match the predicate, so the claim is atomic in SQLite. Unlike an
 * in-process flag it also holds across separate trigger paths (cron hitting the
 * API while the unified pipeline is mid-run) and across process restarts.
 *
 * never-skip.ts keeps its own copy of this logic — it is in production and
 * working, so it is deliberately left alone.
 */

import db from "@/lib/db";

/** Sentinel for "free". A real JSON value so json_extract never sees garbage. */
const LOCK_FREE = '{"at":0}';

export interface RunLock {
  /** Opaque token proving this run is the holder. Pass it back to release(). */
  token: string;
}

export interface LockHolder {
  /** What the current holder is working on. */
  label: string;
  /** Epoch ms when the claim was made. */
  at: number;
}

/**
 * Claim `key`, or return null if another run holds it.
 *
 * `staleMs` bounds how long a claim stays valid: a holder that dies mid-run
 * (container restart) frees the lock after that rather than wedging the job
 * forever. Set it comfortably above the job's normal duration.
 */
export async function acquireLock(
  key: string,
  label: string,
  staleMs: number,
): Promise<RunLock | null> {
  const token = `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  // Create the row if it has never existed. INSERT OR IGNORE cannot disturb a
  // lock that is currently held.
  await db.execute({
    sql: "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
    args: [key, LOCK_FREE],
  });

  const res = await db.execute({
    sql: `UPDATE settings SET value = ?
          WHERE key = ? AND json_extract(value, '$.at') < ?`,
    args: [
      JSON.stringify({ at: Date.now(), token, label }),
      key,
      Date.now() - staleMs,
    ],
  });

  return res.rowsAffected > 0 ? { token } : null;
}

/** Release the lock, but only if this run still holds it. */
export async function releaseLock(key: string, token: string): Promise<void> {
  try {
    await db.execute({
      // The token check matters: if this run overran staleMs and another took
      // over, releasing unconditionally would free a lock we no longer own.
      sql: `UPDATE settings SET value = ?
            WHERE key = ? AND json_extract(value, '$.token') = ?`,
      args: [LOCK_FREE, key, token],
    });
  } catch (err) {
    console.error(`[run-lock] releasing ${key} failed:`, err instanceof Error ? err.message : err);
  }
}

/** What the current holder is working on, if the lock is held and not stale. */
export async function lockHolder(key: string, staleMs: number): Promise<LockHolder | null> {
  try {
    const res = await db.execute({ sql: "SELECT value FROM settings WHERE key = ?", args: [key] });
    const raw = res.rows[0]?.value;
    if (!raw) return null;
    const parsed = JSON.parse(String(raw)) as { at?: number; label?: string };
    if (!parsed.at || parsed.at < Date.now() - staleMs) return null;
    return { label: parsed.label ?? "?", at: parsed.at };
  } catch {
    return null;
  }
}
