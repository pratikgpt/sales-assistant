import { handle } from "@/lib/http";
import { getPolicy, savePolicy } from "@/lib/store";

export async function GET() {
  return handle(getPolicy);
}

export async function POST(req: Request) {
  return handle(async () => savePolicy(await req.json()));
}
