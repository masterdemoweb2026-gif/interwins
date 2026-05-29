import { NextResponse } from "next/server";
import { inboxList } from "@/lib/debugInbox";

export async function GET() {
  return NextResponse.json({ ok: true, events: inboxList() }, { status: 200 });
}
