import type { Policy } from "./policy";

export interface Slot {
  start: string; // ISO, UTC
  end: string;
}
export interface Interval {
  start: string;
  end: string;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Minutes the zone is ahead of UTC at a given instant (DST-aware, via Intl). */
function offsetMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return (Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - at.getTime()) / 60000;
}

/** Converts a wall-clock date and time in `tz` to the UTC instant. */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const naive = Date.UTC(y, m - 1, d, h, mi);
  let utc = naive - offsetMinutes(new Date(naive), tz) * 60000;
  utc = naive - offsetMinutes(new Date(utc), tz) * 60000; // second pass settles DST edges
  return new Date(utc);
}

/** The calendar date (YYYY-MM-DD) of an instant in `tz`. */
export function localDate(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;
const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Every meeting-length slot inside working hours over the booking horizon, respecting notice. */
export function candidateSlots(policy: Policy, now: Date): Slot[] {
  const { timezone: tz, working_hours: wh, meeting } = policy;
  const earliest = now.getTime() + meeting.min_notice_hours * 3600_000;
  const today = localDate(now, tz);
  const out: Slot[] = [];
  for (let d = 0; d <= meeting.horizon_days; d++) {
    const date = addDays(today, d);
    const [y, m, day] = date.split("-").map(Number);
    if (!wh.days.includes(DAYS[new Date(Date.UTC(y, m - 1, day)).getUTCDay()] as (typeof wh.days)[number])) continue;
    for (let t = toMinutes(wh.start); t + meeting.duration_minutes <= toMinutes(wh.end); t += meeting.duration_minutes) {
      const start = zonedToUtc(date, toTime(t), tz);
      if (start.getTime() < earliest) continue;
      out.push({ start: start.toISOString(), end: new Date(start.getTime() + meeting.duration_minutes * 60000).toISOString() });
    }
  }
  return out;
}

/**
 * Picks free slots to offer, spread across days (first free slot of each day, then later ones),
 * so the customer sees real choice instead of three back-to-back times.
 */
export function pickSlots(policy: Policy, now: Date, busy: Interval[]): Slot[] {
  const free = candidateSlots(policy, now).filter((s) => !busy.some((b) => overlaps(s, b)));
  const byDay = new Map<string, Slot[]>();
  for (const s of free) {
    const day = localDate(new Date(s.start), policy.timezone);
    byDay.set(day, [...(byDay.get(day) ?? []), s]);
  }
  // One slot per day per pass, alternating the earliest slot and one mid-day, so offers vary in time
  // of day as well as date ("Fri 10:00, Mon 14:00, Tue 10:00") rather than the same hour each day.
  const queues = [...byDay.values()].map((slots, i) => {
    const mid = slots[Math.floor(slots.length / 2)];
    return [...new Set(i % 2 ? [mid, slots[0], ...slots] : [slots[0], mid, ...slots])];
  });
  const picked: Slot[] = [];
  while (picked.length < policy.meeting.slots_to_offer && queues.some((q) => q.length)) {
    for (const q of queues) {
      const s = q.shift();
      if (s && picked.length < policy.meeting.slots_to_offer) picked.push(s);
    }
  }
  return picked.sort((a, b) => a.start.localeCompare(b.start));
}

export function isFree(slot: Slot, busy: Interval[]): boolean {
  return !busy.some((b) => overlaps(slot, b));
}

/** "Tue 27 Oct, 3:00 PM" in the business timezone, optionally with the zone ("GMT+5:30"). */
export function formatSlot(slot: Slot, tz: string, withZone = true): string {
  const d = new Date(slot.start);
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", ...(withZone ? { timeZoneName: "short" } : {}) }).format(d);
  return `${date}, ${time}`;
}

/** "India Standard Time" for a list footer, so each listed time does not repeat the zone. */
export function zoneName(tz: string): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "long" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName");
  return part?.value ?? tz;
}
