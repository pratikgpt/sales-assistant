import { z } from "zod";
import { humanReply } from "@/lib/dashboard";
import { handle } from "@/lib/http";

export const maxDuration = 30;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { text } = z.object({ text: z.string().trim().min(1).max(2000) }).parse(await req.json());
    return humanReply((await params).id, text);
  });
}
