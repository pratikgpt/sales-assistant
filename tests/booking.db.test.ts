// Booking against a real Postgres with the Google Calendar client mocked, so each failure mode
// (repeat confirmation, slot taken, lost response, auth failure) can be produced on demand.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const cal = vi.hoisted(() => {
  class CalendarError extends Error {
    constructor(readonly kind: string, message: string) {
      super(message);
    }
  }
  return {
    CalendarError,
    calendarIdFor: vi.fn((rep: string) => `${rep}@calendar`),
    freeBusy: vi.fn(),
    insertEvent: vi.fn(),
    getEvent: vi.fn(),
  };
});
vi.mock("@/lib/calendar", () => cal);

const { bookSlot } = await import("@/lib/booking");
const { ensureSchema, sql } = await import("@/lib/db");

const slot = { start: "2026-10-23T09:30:00.000Z", end: "2026-10-23T10:00:00.000Z" };
const event = (id: string) => ({ id, status: "confirmed", htmlLink: `https://calendar.example/${id}`, start: { dateTime: slot.start }, end: { dateTime: slot.end } });

async function newLead() {
  const [c] = await sql`insert into contacts (channel, external_id) values ('whatsapp', ${randomUUID()}) returning id`;
  const [l] = await sql`insert into leads (contact_id) values (${c.id}) returning id`;
  return l.id as string;
}
const book = (leadId: string, repId = `rep_${randomUUID().slice(0, 6)}`) => bookSlot({ leadId, repId, slot, summary: "Intro call", description: "" });

beforeAll(ensureSchema);
beforeEach(() => {
  cal.freeBusy.mockReset().mockResolvedValue([]);
  cal.insertEvent.mockReset().mockImplementation(async (_c: string, e: { id: string }) => event(e.id));
  cal.getEvent.mockReset().mockResolvedValue(null);
});
afterAll(() => sql.end());

describe("bookSlot", () => {
  it("books a free slot once and records the calendar link", async () => {
    const lead = await newLead();
    const r = await book(lead);
    expect(r.kind).toBe("booked");
    expect(cal.insertEvent).toHaveBeenCalledTimes(1);
    if (r.kind === "booked") expect(r.booking.html_link).toContain(r.booking.event_id);
  });

  it("does not create a second event when the customer confirms again", async () => {
    const lead = await newLead();
    const rep = "rep_repeat" + randomUUID().slice(0, 4);
    await book(lead, rep);
    const again = await book(lead, rep);
    expect(again.kind).toBe("already_booked");
    expect(cal.insertEvent).toHaveBeenCalledTimes(1);
  });

  it("does not double-book when two confirmations arrive at the same time", async () => {
    const lead = await newLead();
    const rep = "rep_race" + randomUUID().slice(0, 4);
    const results = await Promise.all([book(lead, rep), book(lead, rep)]);
    expect(cal.insertEvent).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.kind).sort()).toEqual(expect.arrayContaining(["booked"]));
    const [{ n }] = await sql`select count(*)::int as n from bookings where lead_id = ${lead}`;
    expect(n).toBe(1);
  });

  it("rechecks availability and refuses a slot that became busy", async () => {
    cal.freeBusy.mockResolvedValue([{ start: "2026-10-23T09:00:00Z", end: "2026-10-23T10:00:00Z" }]);
    const r = await book(await newLead());
    expect(r.kind).toBe("slot_taken");
    expect(cal.insertEvent).not.toHaveBeenCalled();
  });

  it("never gives two leads the same rep and time", async () => {
    const rep = "rep_shared" + randomUUID().slice(0, 4);
    expect((await book(await newLead(), rep)).kind).toBe("booked");
    expect((await book(await newLead(), rep)).kind).toBe("slot_taken");
  });

  it("resolves a lost response by reading the calendar instead of retrying", async () => {
    cal.insertEvent.mockRejectedValue(new cal.CalendarError("uncertain", "No response from Google Calendar: timeout"));
    cal.getEvent.mockImplementation(async (_c: string, id: string) => event(id)); // it was created after all
    const r = await book(await newLead());
    expect(r.kind).toBe("booked");
    expect(cal.insertEvent).toHaveBeenCalledTimes(1);
  });

  it("stays uncertain (and does not retry) while the calendar cannot be read", async () => {
    cal.insertEvent.mockRejectedValue(new cal.CalendarError("uncertain", "timeout"));
    cal.getEvent.mockRejectedValue(new cal.CalendarError("uncertain", "timeout"));
    const lead = await newLead();
    expect((await book(lead)).kind).toBe("uncertain");
    // A repeated confirmation while uncertain must not write again either.
    expect((await book(lead)).kind).toBe("uncertain");
    expect(cal.insertEvent).toHaveBeenCalledTimes(1);
  });

  it("surfaces an expired calendar connection without booking", async () => {
    cal.freeBusy.mockRejectedValue(new cal.CalendarError("auth", "invalid_grant"));
    const r = await book(await newLead());
    expect(r).toMatchObject({ kind: "failed" });
    const [i] = await sql`select status from integrations where name = 'calendar'`;
    expect(i.status).toBe("auth_error");
  });
});
