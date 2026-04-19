/**
 * Scheduling-timezone helpers.
 *
 * Single source of truth for the timezone used to interpret scheduled
 * publishing times across the app. Configure via the SCHEDULE_TZ env var
 * (e.g. "Europe/Brussels", "Europe/London", "America/New_York",
 * "America/Los_Angeles"). Defaults to "Europe/Brussels".
 *
 * Contract: `publish_date` in the DB is a string of form
 * "YYYY-MM-DDTHH:MM:SS" representing wall-clock time in SCHEDULE_TZ.
 * All server code producing, parsing or comparing `publish_date` must
 * go through these helpers — otherwise the server's own timezone
 * (UTC on Vercel) leaks in and shifts times by the UTC↔SCHEDULE_TZ offset.
 */

export const SCHEDULE_TZ = process.env.SCHEDULE_TZ ?? "Europe/Brussels";

// Single formatter instance — creating a new Intl.DateTimeFormat per call
// is ~30× slower and shows up on hot paths (findDueSlot, nextSlot loops).
const partsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: SCHEDULE_TZ,
  year:   "numeric",
  month:  "2-digit",
  day:    "2-digit",
  hour:   "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

type WallParts = {
  year: number; month: number; day: number;
  hour: number; minute: number; second: number;
};

function partsOf(date: Date): WallParts {
  const out: Record<string, string> = {};
  for (const p of partsFormatter.formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = p.value;
  }
  // Intl returns "24" instead of "00" at the midnight boundary on some platforms
  const hour = parseInt(out.hour, 10) % 24;
  return {
    year:   parseInt(out.year,   10),
    month:  parseInt(out.month,  10),
    day:    parseInt(out.day,    10),
    hour,
    minute: parseInt(out.minute, 10),
    second: parseInt(out.second, 10),
  };
}

function pad(n: number): string { return String(n).padStart(2, "0"); }

/** Current clock time in SCHEDULE_TZ. */
export function scheduleNow(date: Date = new Date()): {
  date:      string;  // "YYYY-MM-DD"
  hours:     number;
  minutes:   number;
  seconds:   number;
  totalMins: number;  // hours*60 + minutes
  absolute:  Date;
} {
  const p = partsOf(date);
  return {
    date:      `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    hours:     p.hour,
    minutes:   p.minute,
    seconds:   p.second,
    totalMins: p.hour * 60 + p.minute,
    absolute:  date,
  };
}

/** Serialise an absolute JS Date to "YYYY-MM-DDTHH:MM:SS" in SCHEDULE_TZ. */
export function toScheduleWallString(date: Date): string {
  const p = partsOf(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/**
 * Convert wall-clock Y/M/D/H/M/S in SCHEDULE_TZ to an absolute JS Date.
 *
 * Strategy: pretend the wall parts are UTC to get a tentative instant, then
 * ask SCHEDULE_TZ what wall time it would report for that instant. The delta
 * between the requested and the reported parts is the TZ's UTC offset at that
 * moment — subtract it from the tentative instant. One pass handles DST.
 */
export function wallPartsToDate(
  y: number, mo: number, d: number, h: number, mi: number, s: number = 0,
): Date {
  const tentative = Date.UTC(y, mo - 1, d, h, mi, s);
  const reported  = partsOf(new Date(tentative));
  const reportedUTC = Date.UTC(
    reported.year, reported.month - 1, reported.day,
    reported.hour, reported.minute,    reported.second,
  );
  // `offsetMs` is how far SCHEDULE_TZ is ahead of UTC at this instant.
  const offsetMs = reportedUTC - tentative;
  return new Date(tentative - offsetMs);
}

/** Parse "YYYY-MM-DDTHH:MM[:SS]" (or with a space separator) as wall-clock
 *  time in SCHEDULE_TZ. Throws on invalid input. */
export function parseScheduleWallString(raw: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(raw);
  if (!m) throw new Error(`Invalid schedule wall-time string: ${raw}`);
  return wallPartsToDate(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? "0"));
}

/**
 * Compute the next scheduling slot. Snaps `after + bufferMinutes` forward to
 * the next `intervalMinutes` boundary in SCHEDULE_TZ wall-clock, then adds
 * 1–9 jitter minutes so times look human-picked rather than landing exactly
 * on :00 or :30. All math is done in SCHEDULE_TZ — the returned Date is an
 * absolute instant.
 */
export function nextSlot(after: Date, intervalMinutes: number, bufferMinutes = 2): Date {
  const shifted     = new Date(after.getTime() + bufferMinutes * 60_000);
  const sw          = scheduleNow(shifted);
  const rounded     = Math.ceil(sw.totalMins / intervalMinutes) * intervalMinutes;
  const jitter      = 1 + Math.floor(Math.random() * 9);
  const targetMins  = rounded + jitter;

  const [yStr, moStr, dStr] = sw.date.split("-");
  const y  = parseInt(yStr,  10);
  const mo = parseInt(moStr, 10);
  const d  = parseInt(dStr,  10);

  // Roll to tomorrow (or beyond) if targetMins overflows the day.
  const dayOffset = Math.floor(targetMins / 1440);
  const minsInDay = targetMins % 1440;
  const targetH   = Math.floor(minsInDay / 60);
  const targetMi  = minsInDay % 60;

  const result = wallPartsToDate(y, mo, d + dayOffset, targetH, targetMi, 0);

  // Guarantee forward progress: if jitter/rounding landed us at-or-before
  // `after`, bump by one interval and try again. Bounded recursion because
  // each call advances `after` by at least `intervalMinutes`.
  if (result <= after) {
    return nextSlot(new Date(after.getTime() + intervalMinutes * 60_000), intervalMinutes, bufferMinutes);
  }
  return result;
}
