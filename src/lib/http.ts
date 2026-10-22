import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { NotFoundError } from "./store";

export async function handle(fn: () => Promise<unknown>) {
  try {
    return NextResponse.json(await fn());
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof ZodError) return NextResponse.json({ error: e.issues.map((i) => `${i.path.join(".") || "policy"}: ${i.message}`).join("; ") }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unexpected error" }, { status: 400 });
  }
}

/** Meta's subscription handshake: echo hub.challenge when the verify token matches. */
export function verifySubscription(req: Request, token: string | undefined) {
  const p = new URL(req.url).searchParams;
  if (token && p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === token) {
    return new Response(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}
