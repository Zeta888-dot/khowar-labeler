import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { DATA_DIR } from "./storage";

export const EXPORTS_DIR = path.join(process.cwd(), "exports");
/** Single, always-rebuilt output folder: exports/latest */
export const LATEST_DIR = path.join(EXPORTS_DIR, "latest");

export type ExportOptions = {
  /** fraction held out for validation (0 = no val split) */
  valRatio: number;
  /** user prompt used in the DeepSeek-OCR conversation format */
  prompt: string;
};

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  valRatio: 0.1,
  prompt: "<image>\nFree OCR. ",
};

export type ExportSummary = {
  name: string;
  dir: string;
  total: number;
  train: number;
  val: number;
  pages: number;
  warnings: string[];
};

type RawRow = { id: string; page: string; line: number; src: string; text: string };
type Row = RawRow & { split: "train" | "val" };

// Invisible direction/format marks that sneak in from keyboards.
// ZWNJ (U+200C) and ZWJ (U+200D) are intentionally KEPT: they are meaningful in Arabic-script text.
const INVISIBLE = /[\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

export function normalizeLabel(t: string): string {
  return t.normalize("NFC").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
}

// Deterministic 0..1 value from a string (stable across exports)
function bucket(key: string): number {
  const d = crypto.createHash("sha1").update(key).digest();
  return d.readUInt32BE(0) / 0x100000000;
}

// Arabic-keyboard characters that usually mean the wrong keyboard layout was used
const CONFUSABLE: Record<string, string> = {
  "\u064A": "Arabic Yeh (ي); Urdu/Khowar keyboard mein ی (U+06CC) hota hai",
  "\u0649": "Alef Maksura (ى); shayad ی (U+06CC) chahiye tha",
  "\u0643": "Arabic Kaf (ك); Urdu keyboard mein ک (U+06A9) hota hai",
  "\u0647": "Arabic Heh (ه); Urdu keyboard mein ہ (U+06C1) ya ھ (U+06BE) hota hai",
};

async function collect(): Promise<RawRow[]> {
  const rows: RawRow[] = [];
  let entries;
  try {
    entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
  } catch {
    return rows;
  }
  const dirs = entries
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const e of dirs) {
    const dir = path.join(DATA_DIR, e.name);
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    if (!files.includes("meta.json")) continue;

    for (const f of files.filter((x) => /^label_\d+\.txt$/.test(x)).sort()) {
      const num = f.match(/^label_(\d+)\.txt$/)![1];
      const img = `image_${num}.jpg`;
      if (!files.includes(img)) continue; // line was deleted
      const text = normalizeLabel(await fs.readFile(path.join(dir, f), "utf-8"));
      if (!text) continue;
      rows.push({
        id: `${e.name}_${num}`,
        page: e.name,
        line: Number(num),
        src: path.join(dir, img),
        text,
      });
    }
  }
  return rows;
}

export async function exportTraining(
  opts: ExportOptions = DEFAULT_EXPORT_OPTIONS
): Promise<ExportSummary> {
  const raw = await collect();
  if (!raw.length) throw new Error("no labeled lines to export");

  // --- train / val split: page-level first (no leakage between train and val)
  let rows: Row[] = raw.map((r) => ({
    ...r,
    split: opts.valRatio > 0 && bucket(r.page) < opts.valRatio ? "val" : "train",
  }));
  const needFallback =
    opts.valRatio > 0 &&
    (!rows.some((r) => r.split === "val") || !rows.some((r) => r.split === "train"));
  if (needFallback) {
    // too few pages for a page-level split -> deterministic line-level split
    rows = raw.map((r) => ({
      ...r,
      split:
        raw.length >= 20 && bucket(`${r.page}/${r.line}`) < opts.valRatio ? "val" : "train",
    }));
  }
  const train = rows.filter((r) => r.split === "train");
  const val = rows.filter((r) => r.split === "val");

  // --- output folder: always rebuilt from scratch (no duplicates across exports)
  const dir = LATEST_DIR;
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  await fs.mkdir(path.join(dir, "images"), { recursive: true });
  for (const r of rows) {
    await fs.copyFile(r.src, path.join(dir, "images", `${r.id}.jpg`));
  }

  // --- formats
  const jsonl = (rs: Row[]) =>
    rs
      .map((r) =>
        JSON.stringify({
          messages: [
            { role: "<|User|>", content: opts.prompt, images: [`images/${r.id}.jpg`] },
            { role: "<|Assistant|>", content: r.text },
          ],
        })
      )
      .join("\n") + "\n";
  const paddle = (rs: Row[]) =>
    rs.map((r) => `images/${r.id}.jpg\t${r.text}`).join("\n") + "\n";

  await fs.writeFile(path.join(dir, "train.jsonl"), jsonl(train), "utf-8");
  await fs.writeFile(path.join(dir, "train.txt"), paddle(train), "utf-8");
  if (val.length) {
    await fs.writeFile(path.join(dir, "val.jsonl"), jsonl(val), "utf-8");
    await fs.writeFile(path.join(dir, "val.txt"), paddle(val), "utf-8");
  }

  // --- charset report + warnings
  const freq = new Map<string, number>();
  for (const r of rows) {
    for (const ch of Array.from(r.text)) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  const charset = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([char, count]) => ({
      char,
      code: "U+" + char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0"),
      count,
    }));
  await fs.writeFile(path.join(dir, "charset.json"), JSON.stringify(charset, null, 1), "utf-8");

  const warnings: string[] = [];
  for (const c of charset) {
    const hint = CONFUSABLE[c.char];
    if (hint) warnings.push(`${c.code} ${c.char} x${c.count}: ${hint}`);
    else if (/[A-Za-z]/.test(c.char)) {
      warnings.push(`${c.code} "${c.char}" x${c.count}: Latin letter (typo?)`);
    }
  }

  // --- manifest (traceability back to page + line)
  const pageCount = new Set(rows.map((r) => r.page)).size;
  await fs.writeFile(
    path.join(dir, "manifest.json"),
    JSON.stringify(
      {
        created: new Date().toISOString(),
        options: opts,
        counts: {
          total: rows.length,
          train: train.length,
          val: val.length,
          pages: pageCount,
        },
        warnings,
        rows: rows.map(({ id, page, line, split }) => ({ id, page, line, split })),
      },
      null,
      1
    ),
    "utf-8"
  );

  return {
    name: "latest",
    dir,
    total: rows.length,
    train: train.length,
    val: val.length,
    pages: pageCount,
    warnings,
  };
}