import { compose, extract, verifyEvidence, type HistoryMessage, type ReplyGoal } from "./assistant";
import { bookSlot } from "./booking";
import { CalendarError, calendarIdFor, freeBusy } from "./calendar";
import { json, logEvent, setIntegration, sql } from "./db";
import type { Usage } from "./llm";
import type { LeadField } from "./policy";
import { qualify, route, type Assignment, type LeadFields } from "./qualify";
import { formatSlot, pickSlots, type Slot } from "./slots";
import { CHANNEL_LABEL, getPolicy, sendReply, type ContactRow, type LeadRow, type Stage } from "./store";

// One customer turn: extract -> qualify -> route -> decide the next step -> reply on the same channel.
// The model words replies; this file decides what happens. Times, bookings and staff come from code.

const ASK: Record<LeadField, string> = {
  company: "the company they are enquiring for",
  service: "what they need help with (dashboards, data engineering or forecasting)",
  budget_usd: "their approximate budget",
  timeline_months: "when they would like to start",
};

const cost = (u: Usage) => (u.cost_usd == null ? "" : `, $${u.cost_usd.toFixed(4)}`);

/**
 * Processes every unhandled inbound message for a lead. A short lease on the lead row means only one
 * worker runs a lead at a time; messages that arrive meanwhile are picked up by the loop, so a
 * burst of messages becomes one reply instead of racing replies.
 */
export async function processLead(leadId: string): Promise<void> {
  for (let pass = 0; pass < 5; pass++) {
    const [lead] = await sql<LeadRow[]>`
      update leads set lease_until = now() + interval '2 minutes'
      where id = ${leadId} and (lease_until is null or lease_until < now()) returning *`;
    if (!lead) return; // another worker holds the lease and will see our message

    let handled = false;
    try {
      const pending = await sql<{ id: string }[]>`
        select id from messages where lead_id = ${leadId} and direction = 'in' and processed_at is null order by created_at`;
      if (!pending.length) return;
      handled = true;
      const ids = pending.map((p) => p.id);

      if (lead.takeover) {
        await logEvent(sql, leadId, "info", "takeover", "Human takeover is on: no automatic reply");
      } else {
        try {
          await runTurn(lead);
        } catch (e) {
          const msg = (e as Error).message;
          await sql`update leads set attention = ${`Assistant could not reply: ${msg}`}, updated_at = now() where id = ${leadId}`;
          await logEvent(sql, leadId, "error", "assistant", `Assistant could not reply: ${msg}`);
          if (/OPENROUTER|model|validation/i.test(msg)) await setIntegration("llm", "error", msg);
        }
      }
      await sql`update messages set processed_at = now() where id = any(${ids}::uuid[])`;
    } finally {
      await sql`update leads set lease_until = null where id = ${leadId}`;
    }
    if (!handled) return;
  }
}

async function runTurn(lead: LeadRow): Promise<void> {
  const { version, data: policy } = await getPolicy();
  const [contact] = await sql<ContactRow[]>`select * from contacts where id = ${lead.contact_id}`;
  const rows = await sql<{ id: string; author: HistoryMessage["author"]; text: string }[]>`
    select id, author, text from (
      select id, author, text, created_at from messages where lead_id = ${lead.id} order by created_at desc limit 30
    ) m order by created_at`;
  // Short ids (M1, M2…) in prompts; mapped back to real message ids for stored evidence.
  const history: HistoryMessage[] = rows.map((r, i) => ({ id: `M${i + 1}`, author: r.author, text: r.text }));
  const realId = new Map(history.map((h, i) => [h.id, rows[i].id]));
  const tz = policy.timezone;

  // 1. Extract evidence and keep only what is verifiably quoted.
  const ex = await extract({
    policy,
    history,
    known: lead.fields,
    offeredSlots: lead.stage === "offering" || lead.stage === "confirming" ? lead.offered_slots.map((s) => formatSlot(s, tz)) : [],
    pendingSlot: lead.pending_slot ? formatSlot(lead.pending_slot, tz) : null,
  });
  await setIntegration("llm", "ok");
  const verified = verifyEvidence(ex.data, history, policy.services.map((s) => s.id));
  if (verified.rejected.length) await logEvent(sql, lead.id, "warn", "evidence", `Discarded unsupported values: ${verified.rejected.join("; ")}`);
  const fields: LeadFields = { ...lead.fields };
  for (const [k, ev] of Object.entries(verified.fields) as [LeadField, NonNullable<LeadFields[LeadField]>][]) {
    fields[k] = { ...ev, message_id: realId.get(ev.message_id) ?? ev.message_id };
  }
  if (ex.data.contact_name && !contact.display_name) await sql`update contacts set display_name = ${ex.data.contact_name} where id = ${contact.id}`;
  const name = contact.display_name ?? ex.data.contact_name;
  if (ex.data.override_attempt) {
    await logEvent(sql, lead.id, "warn", "policy", `Customer tried to override the policy ("${ex.data.override_attempt.quote}"); ignored, rules unchanged`);
  }
  await logEvent(sql, lead.id, "info", "assistant", `Read the conversation (${ex.usage.prompt_tokens + ex.usage.completion_tokens} tokens${cost(ex.usage)})`);

  // 2. Qualify and, once qualified, assign a rep. Both are rule-based.
  const q = qualify(fields, policy);
  if (q.status !== lead.status || !lead.qualification) {
    await logEvent(sql, lead.id, "info", "qualification", `Qualification: ${q.status.replace("_", " ")}`, q.results.map((r) => `${r.id} ${r.outcome}`));
  }
  let assignment: Assignment | null = lead.assignment;
  if (q.status === "qualified" && !assignment) {
    assignment = route(fields, policy);
    await logEvent(sql, lead.id, "info", "routing", `Assigned to ${assignment.rep_name} by rule ${assignment.rule_id}: ${assignment.reason}`);
  }

  // 3. Decide the next step.
  let stage: Stage = lead.stage;
  let offered = lead.offered_slots;
  let pending = lead.pending_slot;
  let attention: string | null = null;
  let goal: ReplyGoal | null = null;
  let tail: string | null = null; // fixed text appended by code (times, confirmations)
  const rep = assignment?.rep_name ?? "our team";

  const listSlots = (slots: Slot[]) => slots.map((s, i) => `${i + 1}. ${formatSlot(s, tz)}`).join("\n");
  const confirmPrompt = (s: Slot) => `To confirm: a ${policy.meeting.duration_minutes}-minute intro call with ${rep} on ${formatSlot(s, tz)}. Reply YES to book it, or tell me another option.`;

  async function offer(prefix?: string) {
    try {
      const calendarId = calendarIdFor(assignment!.rep_id);
      const now = new Date();
      const until = new Date(now.getTime() + (policy.meeting.horizon_days + 1) * 86400_000);
      const busy = await freeBusy(calendarId, now.toISOString(), until.toISOString());
      // When re-offering, skip the times already shown so the customer gets new options.
      const shown = stage === "offering" || stage === "confirming" ? offered : [];
      const slots = pickSlots(policy, now, [...busy, ...shown]);
      await setIntegration("calendar", "ok");
      if (!slots.length) {
        stage = "handoff";
        attention = `No free slots for ${rep} in the next ${policy.meeting.horizon_days} days`;
        tail = `${prefix ? prefix + " " : ""}${rep} has no free times in the next ${policy.meeting.horizon_days} days, so ${rep} will contact you directly to find one.`;
        return;
      }
      offered = slots;
      pending = null;
      stage = "offering";
      if (!prefix) goal = { kind: "intro_slots", rep };
      tail = `${prefix ? prefix + "\n" : ""}${listSlots(slots)}\n\nReply with the number of the time that suits you (all times ${tz.replace("_", " ")}).`;
      await logEvent(sql, lead.id, "info", "slots", `Offered ${slots.length} times from ${rep}'s calendar`, slots.map((s) => formatSlot(s, tz)));
    } catch (e) {
      const err = e as CalendarError;
      stage = "handoff";
      attention = `Calendar unavailable: ${err.message}`;
      if (err instanceof CalendarError) await setIntegration("calendar", err.kind === "auth" ? "auth_error" : "error", err.message);
      await logEvent(sql, lead.id, "error", "slots", `Could not read ${rep}'s calendar: ${err.message}`);
      tail = `Thanks! ${rep} will contact you shortly to find a time that works.`;
    }
  }

  async function book() {
    const slot = pending!;
    const res = await bookSlot({
      leadId: lead.id,
      repId: assignment!.rep_id,
      slot,
      summary: `Intro call: ${String(fields.company?.value ?? name ?? "New lead")} (${CHANNEL_LABEL[contact.channel]})`,
      description: [
        `Lead from ${CHANNEL_LABEL[contact.channel]}: ${name ?? ""} ${contact.handle ?? contact.external_id}`,
        ...q.results.map((r) => `${r.text}: ${r.evidence ? `"${r.evidence.quote}"` : "-"}`),
        `Assigned by rule ${assignment!.rule_id}: ${assignment!.reason}`,
      ].join("\n"),
    });
    if (res.kind === "booked" || res.kind === "already_booked") {
      const when = formatSlot({ start: new Date(res.booking.slot_start).toISOString(), end: "" }, tz);
      stage = "booked";
      pending = null;
      tail =
        res.kind === "booked"
          ? `You're booked: ${policy.meeting.duration_minutes}-minute intro call with ${rep} on ${when}. ${rep} will send the joining details before the call.`
          : `You're already booked with ${rep} on ${when}, so there's nothing more to do.`;
      if (res.kind === "already_booked") await logEvent(sql, lead.id, "info", "booking", "Repeated confirmation: already booked, no new event created");
    } else if (res.kind === "slot_taken") {
      await offer("Sorry, that time was just taken. Here are the next available times:");
    } else if (res.kind === "uncertain") {
      stage = "booking_check";
      attention = "Booking outcome uncertain: check the calendar before confirming with the customer";
      tail = `I'm double-checking that booking with the calendar. ${rep} will confirm it with you shortly.`;
    } else {
      stage = "handoff";
      attention = `Booking failed: ${res.error}`;
      tail = `I couldn't complete the booking just now, so ${rep} will contact you to confirm a time.`;
    }
  }

  if (lead.stage === "booked") {
    const [b] = await sql<{ slot_start: Date }[]>`select slot_start from bookings where lead_id = ${lead.id} and status = 'confirmed'`;
    const when = b ? formatSlot({ start: new Date(b.slot_start).toISOString(), end: "" }, tz) : "the agreed time";
    if (ex.data.confirmation === "yes" || ex.data.slot_choice) {
      await logEvent(sql, lead.id, "info", "booking", "Repeated confirmation: already booked, no new event created");
      tail = `You're already booked with ${rep} on ${when}, so there's nothing more to do.`;
    } else {
      goal = { kind: "answer", context: `Their intro call with ${rep} is booked for ${when}. ${rep} will send joining details. If they want to reschedule, ${rep} will handle it.` };
    }
  } else if (lead.stage === "booking_check") {
    await book(); // reconciles the uncertain booking by reading the calendar; never writes twice
  } else if (lead.stage === "handoff") {
    goal = { kind: "answer", context: `${rep} will contact them directly to arrange a time. Do not offer times.` };
  } else if (q.status === "not_qualified") {
    const reasons = q.results.filter((r) => r.outcome === "fail").map((r) => r.text);
    goal = lead.stage === "closed" ? { kind: "answer", context: `We are not the right fit right now because: ${reasons.join("; ")}. Do not offer a meeting.` } : { kind: "decline", reasons };
    stage = "closed";
  } else if (q.status === "needs_info") {
    stage = "collecting";
    goal = { kind: "ask_missing", missing: q.results.filter((r) => r.outcome === "missing").map((r) => ASK[r.field]) };
  } else if (lead.stage === "collecting" || lead.stage === "closed") {
    await offer();
  } else if (lead.stage === "offering") {
    const choice = ex.data.slot_choice ? offered[ex.data.slot_choice - 1] : undefined;
    if (choice) {
      pending = choice;
      stage = "confirming";
      tail = confirmPrompt(choice);
    } else if (ex.data.wants_other_times) {
      await offer("Here are some other times:");
    } else {
      goal = { kind: "answer", context: `We offered intro-call times with ${rep}; they have not picked one yet.` };
      tail = `${listSlots(offered)}\n\nReply with the number of the time that suits you.`;
    }
  } else if (lead.stage === "confirming") {
    const choice = ex.data.slot_choice ? offered[ex.data.slot_choice - 1] : undefined;
    if (ex.data.confirmation === "yes" && pending) {
      await book();
    } else if (choice && choice.start !== pending?.start) {
      pending = choice;
      tail = confirmPrompt(choice);
    } else if (ex.data.confirmation === "no" || ex.data.wants_other_times) {
      await offer("No problem. Here are some other times:");
    } else {
      goal = { kind: "answer", context: `We are waiting for them to confirm the proposed time with ${rep}.` };
      tail = pending ? confirmPrompt(pending) : null;
    }
  }

  // 4. Persist the decision before replying, so a failed send never loses state.
  await sql`
    update leads set fields = ${json(fields)}, qualification = ${json(q)}, status = ${q.status}, stage = ${stage},
      assignment = ${assignment ? json(assignment) : null}, offered_slots = ${json(offered)}, pending_slot = ${pending ? json(pending) : null},
      policy_version = ${version}, attention = ${attention}, updated_at = now()
    where id = ${lead.id}`;

  // 5. Word the reply and send it on the originating channel.
  let lead_in: string | null = null;
  if (goal) {
    const out = await compose({ policy, history, goal, customerName: name, overrideAttempt: Boolean(ex.data.override_attempt) });
    lead_in = out.data.text;
    await logEvent(sql, lead.id, "info", "assistant", `Drafted reply (${out.usage.prompt_tokens + out.usage.completion_tokens} tokens${cost(out.usage)})`);
  }
  const text = [lead_in, tail].filter(Boolean).join("\n\n");
  if (text) await sendReply(lead.id, text, "assistant");
}

/** Lets a human (or the takeover toggle) re-run the assistant on the latest customer message. */
export async function retryAssistant(leadId: string) {
  const [m] = await sql`
    update messages set processed_at = null
    where id = (select id from messages where lead_id = ${leadId} and direction = 'in' order by created_at desc limit 1)
    returning id`;
  if (!m) throw new Error("No customer message to reply to");
  await sql`update leads set attention = null where id = ${leadId}`;
  await logEvent(sql, leadId, "info", "assistant", "Human asked the assistant to retry the latest message");
  await processLead(leadId);
}

