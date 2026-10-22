import { after, NextResponse } from "next/server";
import { parseWhatsApp } from "@/lib/channels/whatsapp";
import { verifyMetaSignature } from "@/lib/channels/types";
import { ensureSchema, logEvent, setIntegration, sql } from "@/lib/db";
import { processLead } from "@/lib/engine";
import { verifySubscription } from "@/lib/http";
import { ingest, updateDeliveryStatus } from "@/lib/store";

export const maxDuration = 60;

export function GET(req: Request) {
  return verifySubscription(req, process.env.WHATSAPP_VERIFY_TOKEN);
}

export async function POST(req: Request) {
  await ensureSchema();
  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), process.env.META_APP_SECRET)) {
    await logEvent(sql, null, "warn", "webhook", "Rejected a WhatsApp webhook with an invalid signature");
    return new NextResponse("Invalid signature", { status: 401 });
  }
  const { messages, statuses } = parseWhatsApp(JSON.parse(raw));
  const leads = new Set<string>();
  for (const m of messages) {
    const { leadId, duplicate } = await ingest(m);
    if (!duplicate) leads.add(leadId);
  }
  for (const s of statuses) await updateDeliveryStatus("whatsapp", s.external_id, s.status, s.error);
  if (messages.length) await setIntegration("whatsapp", "ok");
  // Acknowledge immediately (Meta retries slow webhooks); reply generation runs after the response.
  after(async () => {
    for (const id of leads) await processLead(id);
  });
  return NextResponse.json({ ok: true });
}
