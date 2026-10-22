import { JWT } from "google-auth-library";
import type { Interval } from "./slots";

// Google Calendar via a service account. Each rep's test calendar is shared with the service
// account ("Make changes to events"), so no end-user OAuth flow or token refresh is needed.

export type CalendarErrorKind = "not_configured" | "auth" | "not_found" | "conflict" | "uncertain" | "rejected";

export class CalendarError extends Error {
  constructor(
    readonly kind: CalendarErrorKind,
    message: string,
  ) {
    super(message);
  }
}

const API = "https://www.googleapis.com/calendar/v3";
const TIMEOUT_MS = 10_000;

let jwt: JWT | undefined;
function client(): JWT {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !key) throw new CalendarError("not_configured", "Google service account is not configured");
  jwt ??= new JWT({ email, key, scopes: ["https://www.googleapis.com/auth/calendar"] });
  return jwt;
}

export function calendarIdFor(repId: string): string {
  const id = process.env[`GOOGLE_CALENDAR_ID_${repId.toUpperCase()}`];
  if (!id) throw new CalendarError("not_configured", `No calendar configured for ${repId}`);
  return id;
}

async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<Response> {
  let token: string | null | undefined;
  try {
    token = (await client().getAccessToken()).token;
  } catch (e) {
    if (e instanceof CalendarError) throw e;
    throw new CalendarError("auth", `Google authentication failed: ${(e as Error).message}`);
  }
  try {
    return await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // Timeout or network failure: for a write we cannot know whether Google applied it.
    throw new CalendarError("uncertain", `No response from Google Calendar: ${(e as Error).message}`);
  }
}

async function fail(res: Response, what: string): Promise<never> {
  const text = await res.text().catch(() => "");
  const detail = `${what}: HTTP ${res.status} ${text.slice(0, 300)}`;
  if (res.status === 401 || res.status === 403) throw new CalendarError("auth", detail);
  if (res.status === 404) throw new CalendarError("not_found", detail);
  if (res.status === 409) throw new CalendarError("conflict", detail);
  if (res.status >= 500 || res.status === 429) throw new CalendarError("uncertain", detail);
  throw new CalendarError("rejected", detail);
}

export async function freeBusy(calendarId: string, timeMin: string, timeMax: string): Promise<Interval[]> {
  const res = await call("POST", "/freeBusy", { timeMin, timeMax, items: [{ id: calendarId }] });
  if (!res.ok) await fail(res, "Availability check failed");
  const data = (await res.json()) as { calendars: Record<string, { busy?: Interval[]; errors?: { reason: string }[] }> };
  const cal = data.calendars[calendarId];
  if (!cal || cal.errors?.length) {
    // freeBusy reports an unshared or missing calendar as an error entry rather than an HTTP error.
    throw new CalendarError("not_found", `Calendar ${calendarId} is not accessible: ${cal?.errors?.map((e) => e.reason).join(", ") ?? "missing"}`);
  }
  return cal.busy ?? [];
}

export interface CalendarEvent {
  id: string;
  status: string;
  htmlLink: string;
  start: { dateTime: string };
  end: { dateTime: string };
}

/**
 * Creates an event with a caller-chosen id. Google rejects a second insert with the same id (409),
 * which is what makes a repeated confirmation unable to create a duplicate.
 */
export async function insertEvent(
  calendarId: string,
  event: { id: string; summary: string; description: string; start: string; end: string },
): Promise<CalendarEvent> {
  const res = await call("POST", `/calendars/${encodeURIComponent(calendarId)}/events`, {
    id: event.id,
    summary: event.summary,
    description: event.description,
    start: { dateTime: event.start },
    end: { dateTime: event.end },
  });
  if (!res.ok) await fail(res, "Creating the calendar event failed");
  return (await res.json()) as CalendarEvent;
}

/** Reads an event back; null if it does not exist or was cancelled. Used to resolve uncertain writes. */
export async function getEvent(calendarId: string, eventId: string): Promise<CalendarEvent | null> {
  const res = await call("GET", `/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`);
  if (res.status === 404 || res.status === 410) return null;
  if (!res.ok) await fail(res, "Reading the calendar event failed");
  const ev = (await res.json()) as CalendarEvent;
  return ev.status === "cancelled" ? null : ev;
}
