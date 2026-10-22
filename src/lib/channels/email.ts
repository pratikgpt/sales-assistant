import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer, { type Transporter } from "nodemailer";
import { SendError, type EmailThread, type Inbound } from "./types";

// Email inbox over IMAP (polled) and SMTP (replies), using a Gmail app password. Replies keep
// In-Reply-To/References so they thread in the customer's mail client.

function config() {
  const user = process.env.EMAIL_ADDRESS;
  const pass = process.env.EMAIL_APP_PASSWORD;
  if (!user || !pass) throw new SendError("Email is not configured");
  return {
    user,
    pass,
    imapHost: process.env.EMAIL_IMAP_HOST || "imap.gmail.com",
    smtpHost: process.env.EMAIL_SMTP_HOST || "smtp.gmail.com",
  };
}

const isAuthError = (e: unknown) => /auth|credential|invalid login|535|AUTHENTICATIONFAILED/i.test(String((e as Error)?.message ?? e));

/** Keeps only the new part of a reply: drops quoted history and common signatures. */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const cut = lines.findIndex(
    (l) => /^On .+wrote:\s*$/.test(l.trim()) || /^-{2,}\s*Original Message/i.test(l.trim()) || /^From: .+/.test(l.trim()) || l.trim() === "--",
  );
  return (cut >= 0 ? lines.slice(0, cut) : lines)
    .filter((l) => !l.startsWith(">"))
    .join("\n")
    .trim();
}

export interface EmailCursor {
  uid_validity: string;
  last_uid: number;
}

/**
 * Fetches messages newer than the cursor. On the first run (no cursor) it only looks at unread
 * mail from the last 3 days, so connecting an old inbox does not reply to its history.
 */
export async function pollEmail(cursor: EmailCursor | null): Promise<{ messages: Inbound[]; cursor: EmailCursor }> {
  const c = config();
  const client = new ImapFlow({ host: c.imapHost, port: 993, secure: true, auth: { user: c.user, pass: c.pass }, logger: false });
  try {
    await client.connect();
  } catch (e) {
    throw new SendError(`Email login failed: ${(e as Error).message}`, isAuthError(e));
  }
  const lock = await client.getMailboxLock("INBOX");
  try {
    const box = client.mailbox as { uidValidity: bigint; uidNext: number };
    const validity = String(box.uidValidity);
    const fresh = !cursor || cursor.uid_validity !== validity;
    const search = fresh ? { seen: false, since: new Date(Date.now() - 3 * 86400_000) } : { uid: `${cursor.last_uid + 1}:*` };
    const uids = ((await client.search(search, { uid: true })) || []).filter((u) => fresh || u > cursor!.last_uid);

    const messages: Inbound[] = [];
    let last = fresh ? Math.max(0, box.uidNext - 1) : cursor.last_uid;
    for (const uid of uids) {
      last = Math.max(last, uid);
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg || !msg.source) continue;
      const mail = await simpleParser(msg.source);
      const from = mail.from?.value[0];
      const auto = mail.headers.get("auto-submitted");
      const bulk = /bulk|list|junk/i.test(String(mail.headers.get("precedence") ?? "")) || mail.headers.has("list-id");
      if (!from?.address || from.address.toLowerCase() === c.user.toLowerCase() || (auto && auto !== "no") || bulk) continue;
      const refs = mail.references ? (Array.isArray(mail.references) ? mail.references : [mail.references]) : [];
      messages.push({
        channel: "email",
        external_id: mail.messageId ?? `uid-${validity}-${uid}`,
        sender: { id: from.address.toLowerCase(), name: from.name || null, handle: from.address.toLowerCase() },
        text: stripQuoted(mail.text ?? "") || "[empty email]",
        thread: { subject: mail.subject ?? "", message_id: mail.messageId, references: refs },
      });
      await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
    }
    return { messages, cursor: { uid_validity: validity, last_uid: last } };
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
}

let transport: Transporter | undefined;

export async function sendEmail(to: string, text: string, thread: EmailThread): Promise<string> {
  const c = config();
  transport ??= nodemailer.createTransport({ host: c.smtpHost, port: 465, secure: true, auth: { user: c.user, pass: c.pass } });
  const subject = thread.subject ? (/^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`) : "Your enquiry";
  try {
    const info = await transport.sendMail({
      from: c.user,
      to,
      subject,
      text,
      inReplyTo: thread.message_id,
      references: [...(thread.references ?? []), ...(thread.message_id ? [thread.message_id] : [])],
    });
    return info.messageId;
  } catch (e) {
    throw new SendError(`Email send failed: ${(e as Error).message}`, isAuthError(e));
  }
}
