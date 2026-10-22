import { createHmac, timingSafeEqual } from "node:crypto";

export type Channel = "whatsapp" | "instagram" | "email";

export interface EmailThread {
  subject?: string;
  message_id?: string;
  references?: string[];
}

/** A normalised inbound message, whatever channel it came from. */
export interface Inbound {
  channel: Channel;
  external_id: string;
  sender: { id: string; name?: string | null; handle?: string | null };
  text: string;
  thread?: EmailThread;
}

/** `auth` marks expired or revoked credentials, which the dashboard shows as a connection problem. */
export class SendError extends Error {
  constructor(
    message: string,
    readonly auth = false,
  ) {
    super(message);
  }
}

export const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";

/**
 * Meta signs webhook bodies with an app secret (X-Hub-Signature-256: sha256=<hex>). Instagram Login
 * apps have two (the Meta app secret and the Instagram app secret), so any configured one may match.
 */
export function verifyMetaSignature(rawBody: string, header: string | null, ...secrets: (string | undefined)[]): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const given = Buffer.from(header.slice(7), "hex");
  return secrets.some((secret) => {
    if (!secret) return false;
    const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** Meta's error code 190 (and HTTP 401) mean the access token expired or was revoked. */
export async function graphError(res: Response, what: string): Promise<SendError> {
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number } };
  const auth = res.status === 401 || body.error?.code === 190;
  return new SendError(`${what}: ${body.error?.message ?? `HTTP ${res.status}`}`, auth);
}
