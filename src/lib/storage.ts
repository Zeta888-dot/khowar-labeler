import fs from "fs/promises";
import path from "path";
import { DEFAULT_PARAMS, LineBox, SegParams, segmentPage } from "./segment";

export const DATA_DIR = path.join(process.cwd(), "dataset");

export type Meta = {
  params: SegParams;
  angle: number;
  boxes: Record<string, LineBox>;
};
export type PageSummary = { id: string; lines: number; labeled: number };
export type LineInfo = { i: number; label: string };
export type PageDetail = {
  id: string;
  params: SegParams;
  angle: number;
  lines: LineInfo[];
};

const pad2 = (i: number) => String(i).padStart(2, "0");
export const imageFile = (i: number) => `image_${pad2(i)}.jpg`;
export const labelFile = (i: number) => `label_${pad2(i)}.txt`;

export function sanitizeLabel(t: string) {
  return t.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

export function validId(id: string) {
  return /^[\w-]+$/.test(id);
}

function pageDir(id: string) {
  if (!validId(id)) throw new Error("bad page id");
  return path.join(DATA_DIR, id);
}

async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function uniqueId(name: string) {
  const stem = name.replace(/\.[^.]+$/, "");
  const base = stem.replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "") || "page";
  let id = base;
  let n = 2;
  while (await exists(path.join(DATA_DIR, id))) id = `${base}_${n++}`;
  return id;
}

async function readMeta(dir: string): Promise<Meta> {
  return JSON.parse(await fs.readFile(path.join(dir, "meta.json"), "utf-8"));
}

async function clearLines(dir: string) {
  for (const f of await fs.readdir(dir)) {
    if (/^(image_\d+\.jpg|label_\d+\.txt)$/.test(f)) {
      await fs.unlink(path.join(dir, f));
    }
  }
}

async function runSegmentation(dir: string, params: SegParams) {
  const original = await fs.readFile(path.join(dir, "original.img"));
  const seg = await segmentPage(original, params);
  const boxes: Record<string, LineBox> = {};
  for (let k = 0; k < seg.lines.length; k++) {
    const i = k + 1;
    await fs.writeFile(path.join(dir, imageFile(i)), seg.lines[k]);
    boxes[String(i)] = seg.boxes[k];
  }
  await fs.writeFile(path.join(dir, "overlay.jpg"), seg.overlay);
  const meta: Meta = { params, angle: seg.angle, boxes };
  await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 1), "utf-8");
}

async function pageLines(dir: string, meta: Meta): Promise<LineInfo[]> {
  const lines: LineInfo[] = [];
  const keys = Object.keys(meta.boxes).sort((a, b) => Number(a) - Number(b));
  for (const k of keys) {
    const i = Number(k);
    if (!(await exists(path.join(dir, imageFile(i))))) continue; // deleted line
    const lf = path.join(dir, labelFile(i));
    const label = (await exists(lf)) ? await fs.readFile(lf, "utf-8") : "";
    lines.push({ i, label });
  }
  return lines;
}

// ------------------------------------------------------------------ public API

export async function listPages(): Promise<PageSummary[]> {
  await ensureDataDir();
  const entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
  const out: PageSummary[] = [];
  for (const e of entries.filter((x) => x.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = path.join(DATA_DIR, e.name);
    if (!(await exists(path.join(dir, "meta.json")))) continue;
    const lines = await pageLines(dir, await readMeta(dir));
    out.push({
      id: e.name,
      lines: lines.length,
      labeled: lines.filter((l) => l.label.trim()).length,
    });
  }
  return out;
}

export async function createPage(
  name: string,
  buffer: Buffer,
  params: SegParams = DEFAULT_PARAMS
): Promise<string> {
  await ensureDataDir();
  const id = await uniqueId(name);
  const dir = pageDir(id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "original.img"), buffer);
  try {
    await runSegmentation(dir, params);
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true });
    throw err;
  }
  return id;
}

export async function getPage(id: string): Promise<PageDetail | null> {
  const dir = pageDir(id);
  if (!(await exists(path.join(dir, "meta.json")))) return null;
  const meta = await readMeta(dir);
  return { id, params: meta.params, angle: meta.angle, lines: await pageLines(dir, meta) };
}

export async function saveLabel(id: string, i: number, text: string): Promise<string> {
  const dir = pageDir(id);
  const clean = sanitizeLabel(text);
  const lf = path.join(dir, labelFile(i));
  if (clean) await fs.writeFile(lf, clean, "utf-8");
  else await fs.rm(lf, { force: true });
  return clean;
}

export async function deleteLine(id: string, i: number) {
  const dir = pageDir(id);
  await fs.rm(path.join(dir, imageFile(i)), { force: true });
  await fs.rm(path.join(dir, labelFile(i)), { force: true });
}

export async function deletePage(id: string) {
  await fs.rm(pageDir(id), { recursive: true, force: true });
}

export async function resegment(id: string, params: SegParams, force = false) {
  const dir = pageDir(id);
  const files = await fs.readdir(dir);
  if (!force && files.some((f) => /^label_\d+\.txt$/.test(f))) {
    throw new Error("labels_exist");
  }
  await clearLines(dir);
  await runSegmentation(dir, params);
}

export async function exportDataset(): Promise<number> {
  await ensureDataDir();
  const rows: { image: string; text: string }[] = [];
  const entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
  for (const e of entries.filter((x) => x.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = path.join(DATA_DIR, e.name);
    const files = (await fs.readdir(dir)).filter((f) => /^label_\d+\.txt$/.test(f)).sort();
    for (const f of files) {
      const num = f.match(/^label_(\d+)\.txt$/)![1];
      const img = `image_${num}.jpg`;
      if (!(await exists(path.join(dir, img)))) continue;
      const text = (await fs.readFile(path.join(dir, f), "utf-8")).trim();
      if (text) rows.push({ image: `${e.name}/${img}`, text });
    }
  }
  await fs.writeFile(
    path.join(DATA_DIR, "labels.tsv"),
    rows.map((r) => `${r.image}\t${r.text}`).join("\n") + "\n",
    "utf-8"
  );
  await fs.writeFile(
    path.join(DATA_DIR, "labels.jsonl"),
    rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf-8"
  );
  return rows.length;
}