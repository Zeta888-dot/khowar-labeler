"use client";

import { useRef, useState } from "react";
import { exportDataset, uploadScans, type PageSummary } from "@/lib/api";

type Props = {
  pages: PageSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onUploaded: (created: string[]) => void;
};

type Status = { kind: "ok" | "err"; text: string } | null;

export default function Sidebar({ pages, activeId, onSelect, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const totalLines = pages.reduce((n, p) => n + p.lines, 0);
  const totalLabeled = pages.reduce((n, p) => n + p.labeled, 0);

  async function handleFiles(list: FileList | File[]) {
    const files = Array.from(list).filter((f) => f.type.startsWith("image/"));
    if (!files.length) {
      setStatus({ kind: "err", text: "Sirf image files (jpg / png) upload karo." });
      return;
    }
    setBusy(true);
    setStatus({ kind: "ok", text: `Processing ${files.length} scan(s)…` });
    try {
      const { created, errors } = await uploadScans(files);
      if (errors.length) {
        setStatus({
          kind: "err",
          text: errors.map((e) => `${e.name}: ${e.error}`).join(" | "),
        });
      } else {
        setStatus({ kind: "ok", text: `${created.length} page(s) ready ✅` });
      }
      if (created.length) onUploaded(created);
    } catch (e) {
      setStatus({ kind: "err", text: e instanceof Error ? e.message : "Upload failed" });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleExport() {
    setBusy(true);
    try {
      const r = await exportDataset();
      setStatus({
        kind: "ok",
        text: `${r.count} lines exported → dataset/labels.tsv + labels.jsonl`,
      });
    } catch (e) {
      setStatus({ kind: "err", text: e instanceof Error ? e.message : "Export failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900 text-neutral-100">
      <div className="border-b border-neutral-800 p-4">
        <h1 className="text-base font-semibold">🏔️ Khowar Line Labeler</h1>
        <p className="mt-1 text-xs text-neutral-400">
          {totalLabeled} / {totalLines} lines labeled · {pages.length} page(s)
        </p>
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && !busy && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!busy) void handleFiles(e.dataTransfer.files);
        }}
        className={`m-3 cursor-pointer rounded-lg border-2 border-dashed p-4 text-center text-sm transition ${
          over
            ? "border-blue-500 bg-blue-500/10 text-neutral-100"
            : "border-neutral-700 text-neutral-400 hover:border-neutral-500"
        } ${busy ? "pointer-events-none opacity-60" : ""}`}
      >
        {busy ? "Working…" : "Scan drop karo (jpg / png) ya click karo"}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => e.target.files && void handleFiles(e.target.files)}
        />
      </div>

      {status && (
        <p
          className={`mx-3 mb-2 rounded-md px-3 py-2 text-xs ${
            status.kind === "ok"
              ? "bg-emerald-500/10 text-emerald-300"
              : "bg-red-500/10 text-red-300"
          }`}
        >
          {status.text}
        </p>
      )}

      <nav className="flex-1 overflow-y-auto">
        {pages.length === 0 && (
          <p className="p-4 text-xs text-neutral-500">Abhi koi page nahi hai.</p>
        )}
        {pages.map((p) => {
          const done = p.lines > 0 && p.labeled === p.lines;
          const pct = p.lines ? (100 * p.labeled) / p.lines : 0;
          return (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              className={`block w-full border-b border-neutral-800 px-4 py-3 text-left text-sm transition hover:bg-neutral-800 ${
                p.id === activeId ? "bg-neutral-800" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{p.id}</span>
                <span
                  className={`shrink-0 text-xs ${done ? "text-emerald-400" : "text-neutral-400"}`}
                >
                  {done ? "✓ " : ""}
                  {p.labeled}/{p.lines}
                </span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded bg-neutral-700">
                <div
                  className={`h-full ${done ? "bg-emerald-500" : "bg-blue-500"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </button>
          );
        })}
      </nav>

      <div className="border-t border-neutral-800 p-3">
        <button
          onClick={handleExport}
          disabled={busy || totalLabeled === 0}
          className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Export TSV / JSONL
        </button>
      </div>
    </aside>
  );
}