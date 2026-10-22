import { retryAssistant } from "@/lib/engine";
import { handle } from "@/lib/http";

export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await retryAssistant((await params).id);
    return { ok: true };
  });
}
