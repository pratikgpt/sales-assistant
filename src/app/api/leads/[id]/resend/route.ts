import { z } from "zod";
import { resend } from "@/lib/dashboard";
import { handle } from "@/lib/http";

export const maxDuration = 30;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { message_id } = z.object({ message_id: z.string().uuid() }).parse(await req.json());
    return resend((await params).id, message_id);
  });
}
