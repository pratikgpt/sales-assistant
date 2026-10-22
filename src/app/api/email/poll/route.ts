import { pollInbox } from "@/lib/dashboard";
import { handle } from "@/lib/http";

export const maxDuration = 60;

/** Scheduled poll (Vercel Cron or an external scheduler), authenticated with CRON_SECRET. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  return handle(pollInbox);
}

/** Poll triggered by the open dashboard; protected by the dashboard session like other routes. */
export async function POST() {
  return handle(pollInbox);
}
