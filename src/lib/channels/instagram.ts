import { GRAPH_VERSION, graphError, SendError, type Inbound } from "./types";

// Instagram API with Instagram Login (no Facebook Page needed). Inbound via the app's webhook
// (field "messages"); outbound via POST graph.instagram.com/me/messages. The business account must
// have "Allow access to messages" turned on under Message controls > Connected tools.

interface IgWebhook {
  object?: string;
  entry?: {
    id?: string;
    messaging?: {
      sender: { id: string };
      recipient: { id: string };
      message?: { mid: string; text?: string; is_echo?: boolean; is_deleted?: boolean; attachments?: { type: string }[] };
    }[];
  }[];
}

export function parseInstagram(body: IgWebhook): Inbound[] {
  const out: Inbound[] = [];
  if (body.object !== "instagram") return out;
  const own = process.env.INSTAGRAM_ACCOUNT_ID;
  for (const entry of body.entry ?? []) {
    for (const ev of entry.messaging ?? []) {
      const m = ev.message;
      // Echoes are our own outgoing messages coming back; skip them and deletions.
      if (!m || m.is_echo || m.is_deleted || ev.sender.id === own || ev.sender.id === entry.id) continue;
      const text = m.text ?? `[${m.attachments?.[0]?.type ?? "non-text"} message — only text is supported]`;
      out.push({ channel: "instagram", external_id: m.mid, sender: { id: ev.sender.id }, text });
    }
  }
  return out;
}

/** Best-effort username lookup so the inbox shows @handle instead of a numeric id. */
export async function instagramProfile(igsid: string): Promise<{ name: string | null; handle: string | null }> {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) return { name: null, handle: null };
  try {
    const res = await fetch(`https://graph.instagram.com/${GRAPH_VERSION}/${igsid}?fields=name,username&access_token=${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return { name: null, handle: null };
    const p = (await res.json()) as { name?: string; username?: string };
    return { name: p.name ?? null, handle: p.username ? `@${p.username}` : null };
  } catch {
    return { name: null, handle: null };
  }
}

export async function sendInstagram(recipientId: string, text: string): Promise<string> {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) throw new SendError("Instagram is not configured");
  let res: Response;
  try {
    res = await fetch(`https://graph.instagram.com/${GRAPH_VERSION}/me/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    throw new SendError(`Instagram did not respond: ${(e as Error).message}`);
  }
  if (!res.ok) throw await graphError(res, "Instagram send failed");
  const data = (await res.json()) as { message_id?: string };
  return data.message_id ?? "";
}
