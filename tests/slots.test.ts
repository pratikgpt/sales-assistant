import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, type Policy } from "@/lib/policy";
import { candidateSlots, formatSlot, localDate, pickSlots, zonedToUtc } from "@/lib/slots";

const policy: Policy = { ...DEFAULT_POLICY, timezone: "Asia/Kolkata" };
// Thu 2026-10-22 09:00 IST
const now = new Date("2026-10-22T03:30:00Z");

describe("timezones", () => {
  it("converts wall-clock time in a zone to UTC", () => {
    expect(zonedToUtc("2026-10-22", "10:00", "Asia/Kolkata").toISOString()).toBe("2026-10-22T04:30:00.000Z");
  });
  it("handles daylight saving zones on both sides of the change", () => {
    expect(zonedToUtc("2026-03-27", "10:00", "Europe/London").toISOString()).toBe("2026-03-27T10:00:00.000Z");
    expect(zonedToUtc("2026-03-30", "10:00", "Europe/London").toISOString()).toBe("2026-03-30T09:00:00.000Z");
  });
  it("finds the local calendar date", () => {
    expect(localDate(new Date("2026-10-22T20:00:00Z"), "Asia/Kolkata")).toBe("2026-10-23");
  });
});

describe("slots", () => {
  const slots = candidateSlots(policy, now);
  it("stays inside working hours and days", () => {
    for (const s of slots) {
      const local = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(s.start));
      expect(local).not.toMatch(/Sat|Sun/);
      const [h, m] = local.split(" ")[1].split(":").map(Number);
      expect(h * 60 + m).toBeGreaterThanOrEqual(600);
      expect(h * 60 + m + 30).toBeLessThanOrEqual(1080);
    }
  });
  it("respects minimum notice", () => {
    expect(new Date(slots[0].start).getTime()).toBeGreaterThanOrEqual(now.getTime() + 4 * 3600_000);
    expect(slots[0].start).toBe("2026-10-22T07:30:00.000Z"); // 13:00 IST, the first slot after 4h notice
  });
  it("skips busy time and spreads offers across days", () => {
    const busy = [{ start: "2026-10-22T00:00:00Z", end: "2026-10-22T23:59:00Z" }];
    const picked = pickSlots(policy, now, busy);
    expect(picked).toHaveLength(3);
    const days = new Set(picked.map((s) => localDate(new Date(s.start), policy.timezone)));
    expect(days.has("2026-10-22")).toBe(false);
    expect(days.size).toBe(3);
  });
  it("formats slots for customers in the business timezone", () => {
    expect(formatSlot({ start: "2026-10-23T09:30:00Z", end: "" }, "Asia/Kolkata")).toBe("Fri 23 Oct, 3:00 PM GMT+5:30");
  });
});
