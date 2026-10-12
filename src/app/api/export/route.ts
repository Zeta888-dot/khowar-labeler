import { NextResponse } from "next/server";
import { DATA_DIR, exportDataset } from "@/lib/storage";

export async function POST() {
  try {
    const count = await exportDataset();
    return NextResponse.json({ ok: true, count, path: DATA_DIR });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}