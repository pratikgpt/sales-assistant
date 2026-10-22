import { randomUUID } from "node:crypto";
import { CalendarError, calendarIdFor, freeBusy, getEvent, insertEvent } from "./calendar";
import { logEvent, setIntegration, sql } from "./db";
import { isFree, type Slot } from "./slots";

export interface BookingRow {
  id: string;
  lead_id: string;
  rep_id: string;
  slot_start: Date;
  slot_end: Date;
  event_id: string;
  status: "pending" | "confirmed" | "uncertain" | "failed";
  html_link: string | null;
  error: string | null;
  created_at: Date;
}

export type BookResult =
  | { kind: "booked"; booking: BookingRow }
  | { kind: "already_booked"; booking: BookingRow }
  | { kind: "slot_taken" }
  | { kind: "uncertain"; booking: BookingRow }
  | { kind: "failed"; error: string };

/** Google event ids allow a-v and 0-9; a UUID's hex digits fit, so the booking row id becomes the event id. */
const eventIdFor = (bookingId: string) => `qa${bookingId.replace(/-/g, "")}`;

async function activeBooking(leadId: string): Promise<BookingRow | undefined> {
  const [b] = await sql<BookingRow[]>`select * from bookings where lead_id = ${leadId} and status in ('pending', 'confirmed', 'uncertain')`;
  return b;
}

async function markCalendarHealth(e: unknown) {
  if (e instanceof CalendarError && (e.kind === "auth" || e.kind === "not_configured" || e.kind === "not_found")) {
    await setIntegration("calendar", e.kind === "auth" ? "auth_error" : "error", e.message);
  }
}

/**
 * Resolves a booking whose outcome is unknown by reading the calendar, never by writing again.
 * Found -> confirmed. Definitely absent -> failed (safe to offer slots again). Unreadable -> stays uncertain.
 */
export async function reconcile(booking: BookingRow): Promise<BookingRow> {
  try {
    const ev = await getEvent(calendarIdFor(booking.rep_id), booking.event_id);
    const status = ev ? "confirmed" : "failed";
    const [row] = await sql<BookingRow[]>`
      update bookings set status = ${status}, html_link = ${ev?.htmlLink ?? null},
        error = ${ev ? null : "Calendar has no such event; the earlier request did not create it"}, updated_at = now()
      where id = ${booking.id} returning *`;
    await logEvent(sql, booking.lead_id, ev ? "info" : "warn", "booking", ev ? "Checked calendar: the uncertain booking exists, marked confirmed" : "Checked calendar: the uncertain booking was not created, marked failed");
    return row;
  } catch (e) {
    await markCalendarHealth(e);
    await logEvent(sql, booking.lead_id, "error", "booking", `Could not check the calendar for the uncertain booking: ${(e as Error).message}`);
    return booking;
  }
}

/**
 * Books a confirmed slot exactly once.
 * 1. An existing live booking for the lead is returned, not duplicated (repeated "yes").
 * 2. Availability is rechecked right before writing (slot may have been taken since it was offered).
 * 3. A pending row is inserted first; unique indexes stop a second booking for the lead or the slot.
 * 4. The event is created with an id derived from that row, so Google itself rejects duplicates.
 * 5. If Google's response is lost, the booking is "uncertain" and is reconciled by reading, never retried.
 */
export async function bookSlot(opts: {
  leadId: string;
  repId: string;
  slot: Slot;
  summary: string;
  description: string;
}): Promise<BookResult> {
  const { leadId, repId, slot } = opts;

  let existing = await activeBooking(leadId);
  // A fresh "pending" row belongs to a request that is still talking to Google; let it finish.
  if (existing?.status === "pending" && Date.now() - new Date(existing.created_at).getTime() < 60_000) return { kind: "uncertain", booking: existing };
  if (existing && existing.status !== "confirmed") existing = await reconcile(existing);
  if (existing?.status === "confirmed") return { kind: "already_booked", booking: existing };
  if (existing?.status === "uncertain") return { kind: "uncertain", booking: existing };

  let calendarId: string;
  try {
    calendarId = calendarIdFor(repId);
    const busy = await freeBusy(calendarId, slot.start, slot.end);
    if (!isFree(slot, busy)) {
      await logEvent(sql, leadId, "warn", "booking", "Rechecked availability before booking: the slot is now busy, not booked");
      return { kind: "slot_taken" };
    }
  } catch (e) {
    await markCalendarHealth(e);
    await logEvent(sql, leadId, "error", "booking", `Availability recheck failed, nothing booked: ${(e as Error).message}`);
    return { kind: "failed", error: (e as Error).message };
  }

  let booking: BookingRow;
  const id = randomUUID();
  try {
    [booking] = await sql<BookingRow[]>`
      insert into bookings (id, lead_id, rep_id, slot_start, slot_end, event_id, status)
      values (${id}, ${leadId}, ${repId}, ${slot.start}, ${slot.end}, ${eventIdFor(id)}, 'pending')
      returning *`;
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      // A concurrent confirmation won the race, or another lead holds this rep's slot.
      const raced = await activeBooking(leadId);
      if (raced) return raced.status === "confirmed" ? { kind: "already_booked", booking: raced } : { kind: "uncertain", booking: raced };
      await logEvent(sql, leadId, "warn", "booking", "Slot was just booked for another lead, not booked");
      return { kind: "slot_taken" };
    }
    throw e;
  }

  try {
    const ev = await insertEvent(calendarId, {
      id: booking.event_id,
      summary: opts.summary,
      description: opts.description,
      start: slot.start,
      end: slot.end,
    });
    [booking] = await sql<BookingRow[]>`update bookings set status = 'confirmed', html_link = ${ev.htmlLink}, updated_at = now() where id = ${booking.id} returning *`;
    await setIntegration("calendar", "ok");
    await logEvent(sql, leadId, "info", "booking", `Calendar event created for ${repId}`, { event_id: ev.id, link: ev.htmlLink });
    return { kind: "booked", booking };
  } catch (e) {
    const err = e as CalendarError;
    if (err.kind === "conflict" || err.kind === "uncertain") {
      // 409 means an event with this id already exists; a lost response means it might. Read, don't retry.
      [booking] = await sql<BookingRow[]>`update bookings set status = 'uncertain', error = ${err.message}, updated_at = now() where id = ${booking.id} returning *`;
      await logEvent(sql, leadId, "warn", "booking", `Booking outcome unknown (${err.message}); checking the calendar instead of retrying`);
      booking = await reconcile(booking);
      if (booking.status === "confirmed") return { kind: "booked", booking };
      if (booking.status === "uncertain") return { kind: "uncertain", booking };
      return { kind: "failed", error: booking.error ?? err.message };
    }
    await markCalendarHealth(e);
    await sql`update bookings set status = 'failed', error = ${err.message}, updated_at = now() where id = ${booking.id}`;
    await logEvent(sql, leadId, "error", "booking", `Calendar rejected the booking: ${err.message}`);
    return { kind: "failed", error: err.message };
  }
}
