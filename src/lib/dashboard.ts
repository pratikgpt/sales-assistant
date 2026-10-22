import { reconcile, type BookingRow } from "./booking";
import { pollEmail, type EmailCursor } from "./channels/email";
import { SendError } from "./channels/types";
import { ensureSchema, json, logEvent, setIntegration, sql } from "./db";
import { processLead } from "./engine";
import { ingest, NotFoundError, sendReply, type ContactRow, type LeadRow } from "./store";

// Read models and human actions for the dashboard.

export async function listLeads() {
  await ensureSchema();
  return sql`
    select l.id, l.status, l.stage, l.takeover, l.attention, l.assignment, l.last_message_at,
      c.channel, c.display_name, c.handle, c.external_id,
      (select text from messages m where m.lead_id = l.id order by created_at desc limit 1) as last_text,
      (select direction from messages m where m.lead_id = l.id order by created_at desc limit 1) as last_direction,
      (select status from bookings b where b.lead_id = l.id and b.status in ('pending','confirmed','uncertain') limit 1) as booking_status,
      exists (select 1 from messages m where m.lead_id = l.id and m.direction = 'out' and m.status = 'failed') as has_failed_send
    from leads l join contacts c on c.id = l.contact_id
    order by l.last_message_at desc`;
}

export async function leadDetail(id: string) {
  await ensureSchema();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError("Lead not found");
  const [lead] = await sql<LeadRow[]>`select * from leads where id = ${id}`;
  if (!lead) throw new NotFoundError("Lead not found");
  const [[contact], messages, events, bookings] = await Promise.all([
    sql<ContactRow[]>`select * from contacts where id = ${lead.contact_id}`,
    sql`select id, direction, author, text, status, error, created_at from messages where lead_id = ${id} order by created_at`,
    sql`select id, level, kind, text, data, created_at from events where lead_id = ${id} order by id`,
    sql<BookingRow[]>`select * from bookings where lead_id = ${id} order by created_at`,
  ]);
  return { lead, contact, messages, events, bookings };
}

export async function setTakeover(id: string, on: boolean) {
  const [l] = await sql`update leads set takeover = ${on}, updated_at = now() where id = ${id} returning id`;
  if (!l) throw new NotFoundError("Lead not found");
  await logEvent(sql, id, on ? "warn" : "info", "takeover", on ? "Human took over: automatic replies and bookings stopped" : "Handed back to the assistant");
}

export async function humanReply(id: string, text: string) {
  const [l] = await sql<{ takeover: boolean }[]>`select takeover from leads where id = ${id}`;
  if (!l) throw new NotFoundError("Lead not found");
  if (!l.takeover) throw new Error("Take over the conversation before replying yourself");
  return sendReply(id, text, "human");
}

/** Re-sends a failed outbound message as a new message; only a human can trigger this. */
export async function resend(leadId: string, messageId: string) {
  const [m] = await sql<{ text: string; author: "assistant" | "human" }[]>`
    select text, author from messages where id = ${messageId} and lead_id = ${leadId} and direction = 'out' and status = 'failed'`;
  if (!m) throw new NotFoundError("No failed message to resend");
  await sql`update messages set status = 'failed_resent' where id = ${messageId}`;
  return sendReply(leadId, m.text, m.author);
}

export async function checkBooking(leadId: string) {
  const [b] = await sql<BookingRow[]>`select * from bookings where lead_id = ${leadId} and status in ('pending','uncertain')`;
  if (!b) throw new NotFoundError("No uncertain booking for this lead");
  const r = await reconcile(b);
  if (r.status === "confirmed") await sql`update leads set stage = 'booked', attention = null where id = ${leadId}`;
  if (r.status === "failed") await sql`update leads set stage = 'handoff', attention = 'Booking was not created; arrange a time with the customer' where id = ${leadId}`;
  return r;
}

export async function integrations() {
  await ensureSchema();
  const rows = await sql<{ name: string; status: string; detail: string | null; last_ok_at: Date | null; last_error_at: Date | null; updated_at: Date }[]>`select * from integrations`;
  const env = process.env;
  const configured: Record<string, boolean> = {
    whatsapp: Boolean(env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID && env.META_APP_SECRET),
    instagram: Boolean(env.INSTAGRAM_ACCESS_TOKEN && env.INSTAGRAM_APP_SECRET),
    email: Boolean(env.EMAIL_ADDRESS && env.EMAIL_APP_PASSWORD),
    calendar: Boolean(env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY && env.GOOGLE_CALENDAR_ID_REP_1 && env.GOOGLE_CALENDAR_ID_REP_2),
    llm: Boolean(env.OPENROUTER_API_KEY),
  };
  return Object.entries(configured).map(([name, ok]) => {
    const row = rows.find((r) => r.name === name);
    return { name, configured: ok, status: ok ? (row?.status ?? "unknown") : "not_configured", detail: row?.detail ?? null, last_ok_at: row?.last_ok_at ?? null, last_error_at: row?.last_error_at ?? null };
  });
}

/** Polls the inbox (from the open dashboard or a cron) and runs the assistant on new emails. */
export async function pollInbox(): Promise<{ fetched: number; new: number }> {
  await ensureSchema();
  if (!process.env.EMAIL_ADDRESS || !process.env.EMAIL_APP_PASSWORD) return { fetched: 0, new: 0 };
  // A row lock stops overlapping polls from reading the same cursor. Messages are stored before the
  // cursor commits, so a crash can only cause a re-fetch (deduplicated), never a lost email.
  await sql`insert into integrations (name, status) values ('email', 'unknown') on conflict do nothing`;
  const polled = await sql.begin(async (tx) => {
    const [row] = await tx<{ cursor: EmailCursor | null }[]>`select cursor from integrations where name = 'email' for update skip locked`;
    if (!row) return { leads: [] as string[], fetched: 0 };
    let result;
    try {
      result = await pollEmail(row.cursor);
    } catch (e) {
      return { error: e as SendError };
    }
    const leads = new Set<string>();
    for (const m of result.messages) {
      const { leadId, duplicate } = await ingest(m);
      if (!duplicate) leads.add(leadId);
    }
    await tx`update integrations set cursor = ${json(result.cursor)}, status = 'ok', detail = null, last_ok_at = now(), updated_at = now() where name = 'email'`;
    return { leads: [...leads], fetched: result.messages.length };
  });
  if ("error" in polled && polled.error) {
    await setIntegration("email", polled.error.auth ? "auth_error" : "error", polled.error.message);
    throw polled.error;
  }
  for (const id of polled.leads) await processLead(id);
  return { fetched: polled.fetched, new: polled.leads.length };
}
