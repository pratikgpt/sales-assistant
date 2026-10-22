import { z } from "zod";
import { setTakeover } from "@/lib/dashboard";
import { handle } from "@/lib/http";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { on } = z.object({ on: z.boolean() }).parse(await req.json());
    await setTakeover((await params).id, on);
    return { ok: true };
  });
}
