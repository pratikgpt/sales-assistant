import { ensureSchema, json, logEvent, setIntegration, sql } from "./db";
import { DEFAULT_POLICY, Policy } from "./policy";
import { sendEmail } from "./channels/email";
import { instagramProfile, sendInstagram } from "./channels/instagram";
import { sendWhatsApp } from "./channels/whatsapp";
import { SendError, type Channel, type EmailThread, type Inbound } from "./channels/types";
import type { Assignment, LeadFields, Qualification } from "./qualify";
import type { Slot } from "./slots";

export class NotFoundError extends Error {}

export interface ContactRow {
  id: string;
  channel: Channel;
  external_id: string;
  display_name: string | null;
  handle: string | null;
}

export type Stage = "collecting" | "offering" | "confirming" | "booking_check" | "booked" | "closed" | "handoff";

export interface LeadRow {
  id: string;
  contact_id: string;
  status: Qualification["status"];
  stage: Stage;
  fields: LeadFields;
  qualification: Qualification | null;
  assignment: Assignment | null;
  offered_slots: Slot[];
  pending_slot: Slot | null;
  policy_version: number | null;
  takeover: boolean;
  attention: string | null;
  thread: EmailThread;
  created_at: Date;
  updated_at: Date;
}

export const CHANNEL_LABEL: Record<Channel, string> = { whatsapp: "WhatsApp", instagram: "Instagram", email: "Email" };

// ---------- Policy ----------

export async function getPolicy(): Promise<{ version: number; data: Policy }> {
  await ensureSchema();
  const [row] = await sql<{ version: number; data: Policy }[]>`select version, data from policy where id = 1`;
  if (row) return row;
  const [created] = await sql<{ version: number; data: Policy }[]>`
    insert into policy (id, version, data) values (1, 1, ${json(DEFAULT_POLICY)})
    on conflict (id) do update set id = 1 returning version, data`;
  return created;
}

export async function savePolicy(input: unknown): Promise<{ version: number; data: Policy }> {
  const data = Policy.parse(input);
  await getPolicy();
  const [row] = await sql<{ version: number; data: Policy }[]>`
    update policy set data = ${json(data)}, version = version + 1, updated_at = now() where id = 1 returning version, data`;
  await logEvent(sql, null, "info", "policy", `Policy updated to version ${row.version}`);
  return row;
}

// ---------- Inbound ----------

/**
 * Stores an inbound message under its (channel, sender) contact and lead. A redelivered webhook or
 * a re-fetched email hits the unique index and is reported as a duplicate, so it is processed once.
 */
export async function ingest(msg: Inbound): Promise<{ leadId: string; duplicate: boolean }> {
  await ensureSchema();
  let { name, handle } = msg.sender;
  if (msg.channel === "instagram" && !handle) ({ name, handle } = await instagramProfile(msg.sender.id));

  return sql.begin(async (tx) => {
    const [contact] = await tx<{ id: string }[]>`
      insert into contacts (channel, external_id, display_name, handle)
      values (${msg.channel}, ${msg.sender.id}, ${name ?? null}, ${handle ?? null})
      on conflict (channel, external_id) do update set
        display_name = coalesce(contacts.display_name, excluded.display_name),
        handle = coalesce(excluded.handle, contacts.handle)
      returning id`;
    const [lead] = await tx<{ id: string; created: boolean }[]>`
      insert into leads (contact_id) values (${contact.id})
      on conflict (contact_id) do update set last_message_at = now()
      returning id, (xmax = 0) as created`;
    const stored = await tx`
      insert into messages (lead_id, channel, direction, author, external_id, text, status)
      values (${lead.id}, ${msg.channel}, 'in', 'customer', ${msg.external_id}, ${msg.text}, 'received')
      on conflict (channel, external_id) where external_id is not null do nothing
      returning id`;
    if (!stored.length) return { leadId: lead.id, duplicate: true };

    if (msg.thread) await tx`update leads set thread = ${json(msg.thread)} where id = ${lead.id}`;
    await tx`update leads set last_message_at = now() where id = ${lead.id}`;
    if (lead.created) await logEvent(tx, lead.id, "info", "lead", `New lead from ${CHANNEL_LABEL[msg.channel]}`);
    await logEvent(tx, lead.id, "info", "inbound", `${CHANNEL_LABEL[msg.channel]} message received`);
    return { leadId: lead.id, duplicate: false };
  });
}

export async function updateDeliveryStatus(channel: Channel, externalId: string, status: string, error: string | null) {
  const [m] = await sql<{ lead_id: string }[]>`
    update messages set status = ${status}, error = coalesce(${error}, error)
    where channel = ${channel} and external_id = ${externalId} and direction = 'out' returning lead_id`;
  if (m && status === "failed") await logEvent(sql, m.lead_id, "error", "delivery", `${CHANNEL_LABEL[channel]} reported the reply as not delivered: ${error ?? "no reason given"}`);
}

// ---------- Outbound ----------

/**
 * Sends a reply on the lead's own channel and records the outcome. Failures are stored on the
 * message and in the integration status; nothing is retried automatically.
 */
export async function sendReply(leadId: string, text: string, author: "assistant" | "human"): Promise<{ ok: boolean; error?: string }> {
  const [row] = await sql<(ContactRow & { thread: EmailThread })[]>`
    select c.*, l.thread from leads l join contacts c on c.id = l.contact_id where l.id = ${leadId}`;
  if (!row) throw new NotFoundError("Lead not found");
  const [msg] = await sql<{ id: string }[]>`
    insert into messages (lead_id, channel, direction, author, text, status)
    values (${leadId}, ${row.channel}, 'out', ${author}, ${text}, 'sending') returning id`;
  const label = CHANNEL_LABEL[row.channel];
  try {
    const externalId =
      row.channel === "whatsapp"
        ? await sendWhatsApp(row.external_id, text)
        : row.channel === "instagram"
          ? await sendInstagram(row.external_id, text)
          : await sendEmail(row.external_id, text, row.thread);
    await sql`update messages set status = 'sent', external_id = ${externalId || null} where id = ${msg.id}`;
    await setIntegration(row.channel, "ok");
    await logEvent(sql, leadId, "info", "outbound", `${author === "human" ? "Human" : "Assistant"} reply sent on ${label}`);
    return { ok: true };
  } catch (e) {
    const err = e instanceof SendError ? e : new SendError((e as Error).message);
    await sql`update messages set status = 'failed', error = ${err.message} where id = ${msg.id}`;
    await setIntegration(row.channel, err.auth ? "auth_error" : "error", err.message);
    await logEvent(sql, leadId, "error", "outbound", `Reply not sent on ${label}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}
