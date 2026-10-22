import { checkBooking } from "@/lib/dashboard";
import { handle } from "@/lib/http";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => checkBooking((await params).id));
}
