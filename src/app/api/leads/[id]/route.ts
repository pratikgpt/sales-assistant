import { leadDetail } from "@/lib/dashboard";
import { handle } from "@/lib/http";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => leadDetail((await params).id));
}
