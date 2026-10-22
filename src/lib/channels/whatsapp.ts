import { GRAPH_VERSION, graphError, SendError, type Inbound } from "./types";

// WhatsApp Cloud API. Inbound via the app's webhook (field "messages"); outbound via
// POST /{phone-number-id}/messages. Replies are sent inside the 24-hour customer service window
// that the customer's own message opens, so plain text messages are allowed.

interface WaWebhook {
  object?: string;
  entry?: {
    changes?: {
      field?: string;
      value?: {
        contacts?: { wa_id: string; profile?: { name?: string } }[];
        messages?: { id: string; from: string; type: string; text?: { body: string }; button?: { text: string }; interactive?: unknown }[];
        statuses?: { id: string; status: string; errors?: { title?: string; message?: string }[] }[];
      };
    }[];
  }[];
}

export interface DeliveryStatus {
  external_id: string;
  status: string;
  error: string | null;
}

export function parseWhatsApp(body: WaWebhook): { messages: Inbound[]; statuses: DeliveryStatus[] } {
  const messages: Inbound[] = [];
  const statuses: DeliveryStatus[] = [];
  if (body.object !== "whatsapp_business_account") return { messages, statuses };
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value;
      if (!v) continue;
      for (const m of v.messages ?? []) {
        const name = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? null;
        const text = m.text?.body ?? m.button?.text ?? `[${m.type} message — only text is supported]`;
        messages.push({ channel: "whatsapp", external_id: m.id, sender: { id: m.from, name, handle: `+${m.from}` }, text });
      }
      for (const s of v.statuses ?? []) {
        statuses.push({ external_id: s.id, status: s.status, error: s.errors?.map((e) => e.message ?? e.title).join("; ") || null });
      }
    }
  }
  return { messages, statuses };
}

export async function sendWhatsApp(to: string, text: string): Promise<string> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) throw new SendError("WhatsApp is not configured");
  let res: Response;
  try {
    res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: text, preview_url: false } }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    throw new SendError(`WhatsApp did not respond: ${(e as Error).message}`);
  }
  if (!res.ok) throw await graphError(res, "WhatsApp send failed");
  const data = (await res.json()) as { messages?: { id: string }[] };
  return data.messages?.[0]?.id ?? "";
}
