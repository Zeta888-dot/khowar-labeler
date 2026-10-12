import fs from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { DATA_DIR, validId } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string; file: string }> };

const ALLOWED = /^(image_\d+\.jpg|overlay\.jpg)$/;

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id, file } = await params;
  if (!validId(id) || !ALLOWED.test(file)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  try {
    const buf = await fs.readFile(path.join(DATA_DIR, id, file));
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}