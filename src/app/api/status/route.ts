import { integrations } from "@/lib/dashboard";
import { handle } from "@/lib/http";

export async function GET() {
  return handle(integrations);
}
