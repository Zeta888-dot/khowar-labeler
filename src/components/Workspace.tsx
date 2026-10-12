"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  deleteLine,
  deletePage,
  getPage,
  lineImageUrl,
  saveLabel,
  type PageDetail,
} from "@/lib/api";
import {
  ChevronLeft,
  ChevronRight,
  Save,
  SkipForward,
  Trash2,
  Keyboard,
} from "lucide-react";

type Props = {
  pageId: string;
  /** bump to force reload + bust image cache (e.g. after resegment) */
  version: number;
  onChanged: () => void;
  onPageDeleted: () => void;
  children?: ReactNode;
};

type Zoom = "fit" | 1 | 2;

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function Workspace({
  pageId,
  version,
  onChanged,
  onPageDeleted,
  children,
}: Props) {
  const [page, setPage] = useState<PageDetail | null>(null);
  const [idx, setIdx] = useState(0);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [natW, setNatW] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Load page (parent remounts this component via `key` on page/version change)
  useEffect(() => {
    let cancelled = false;
    getPage(pageId)
      .then((p) => {
        if (cancelled) return;
        const first = p.lines.findIndex((l) => !l.label.trim());
        const start = first >= 0 ? first : 0;
        setPage(p);
        setIdx(start);
        setDraft(p.lines[start]?.label ?? "");
      })
      .catch((e) => !cancelled && setError(msg(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [pageId, version]);

  const line = page?.lines[idx];
  const curId = page?.id;

  // Keep typing focus on the box whenever the line changes
  useEffect(() => {
    taRef.current?.focus();
  }, [idx, curId]);

  const total = page?.lines.length ?? 0;
  const labeled = page ? page.lines.filter((l) => l.label.trim()).length : 0;

  async function saveCurrent(): Promise<boolean> {
    if (!page || !line) return true;
    if (draft.trim() === line.label.trim()) return true;
    setSaving(true);
    try {
      const saved = await saveLabel(page.id, line.i, draft);
      setPage((prev) =>
        prev
          ? {
              ...prev,
              lines: prev.lines.map((l) => (l.i === line.i ? { ...l, label: saved } : l)),
            }
          : prev
      );
      setError(null);
      onChanged();
      return true;
    } catch (e) {
      setError(`Save failed: ${msg(e)}`);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function goTo(target: number) {
    if (!page) return;
    if (!(await saveCurrent())) return;
    const t = Math.max(0, Math.min(page.lines.length - 1, target));
    if (t === idx) return;
    setNotice(null);
    setIdx(t);
    setDraft(page.lines[t].label);
  }

  async function saveAndNext() {
    if (!page) return;
    if (idx < page.lines.length - 1) await goTo(idx + 1);
    else if (await saveCurrent()) setNotice("Page complete");
  }

  async function jumpUnlabeled() {
    if (!page || !page.lines.length) return;
    const n = page.lines.length;
    for (let step = 1; step <= n; step++) {
      const k = (idx + step) % n;
      if (!page.lines[k].label.trim() && k !== idx) {
        await goTo(k);
        return;
      }
    }
    setNotice("All lines are labeled");
  }

  async function removeLine() {
    if (!page || !line) return;
    if (!window.confirm(`Delete line ${line.i}? (image and label)`)) return;
    try {
      await deleteLine(page.id, line.i);
      const lines = page.lines.filter((l) => l.i !== line.i);
      const next = Math.min(idx, lines.length - 1);
      setPage({ ...page, lines });
      setIdx(Math.max(0, next));
      setDraft(lines[next]?.label ?? "");
      onChanged();
    } catch (e) {
      setError(`Delete failed: ${msg(e)}`);
    }
  }

  async function removePage() {
    if (!page) return;
    if (!window.confirm(`Delete the entire page "${page.id}" (all images and labels)?`)) {
      return;
    }
    try {
      await deletePage(page.id);
      onPageDeleted();
    } catch (e) {
      setError(`Delete failed: ${msg(e)}`);
    }
  }

  if (loading) {
    return <div className="p-8 text-sm text-neutral-400">Loading…</div>;
  }
  if (!page) {
    return <div className="p-8 text-sm text-red-300">{error ?? "Page not found."}</div>;
  }

  const btn =
    "flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 transition hover:border-blue-500 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="flex flex-col gap-4 p-6 text-neutral-100">
      {/* header */}
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-semibold">{page.id}</h2>
        <span className="text-sm text-neutral-400">
          {total ? `line ${idx + 1}/${total}` : "no lines"} · {labeled} labeled
        </span>
        <div className="h-2 flex-1 overflow-hidden rounded bg-neutral-800">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: total ? `${(100 * labeled) / total}%` : "0%" }}
          />
        </div>
        <button
          onClick={removePage}
          className="flex items-center gap-1.5 rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-red-500 hover:text-red-400"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete page
        </button>
      </div>

      {error && (
        <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
      )}
      {notice && (
        <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          {notice}
        </p>
      )}

      {line ? (
        <>
          {/* zoom */}
          <div className="flex items-center gap-2 text-xs text-neutral-400">
            Zoom:
            {(["fit", 1, 2] as Zoom[]).map((z) => (
              <button
                key={String(z)}
                onClick={() => setZoom(z)}
                className={`rounded px-2 py-1 transition ${
                  zoom === z
                    ? "bg-blue-600 text-white"
                    : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                }`}
              >
                {z === "fit" ? "Fit" : `${z}×`}
              </button>
            ))}
            <span className="ml-auto">
              {saving ? "saving…" : `line #${line.i}`}
            </span>
          </div>

          {/* line image */}
          <div className="overflow-x-auto rounded-lg bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={`${page.id}-${line.i}-${version}`}
              src={lineImageUrl(page.id, line.i, version)}
              alt={`line ${line.i}`}
              onLoad={(e) => setNatW(e.currentTarget.naturalWidth)}
              style={
                zoom === "fit"
                  ? { width: "100%", height: "auto" }
                  : natW
                  ? { width: natW * zoom, maxWidth: "none", height: "auto" }
                  : undefined
              }
            />
          </div>

          {/* label box */}
          <textarea
            ref={taRef}
            dir="rtl"
            lang="ur"
            rows={2}
            value={draft}
            spellCheck={false}
            placeholder="Type the label here… (Enter = save + next)"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void saveCurrent()}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter") {
                e.preventDefault();
                void saveAndNext();
              } else if (e.altKey && e.key === "ArrowDown") {
                e.preventDefault();
                void goTo(idx + 1);
              } else if (e.altKey && e.key === "ArrowUp") {
                e.preventDefault();
                void goTo(idx - 1);
              }
            }}
            className="w-full resize-none rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 text-3xl leading-[2] outline-none focus:border-blue-500"
            style={{
              fontFamily:
                '"Jameel Noori Nastaleeq","Noto Nastaliq Urdu","Noto Naskh Arabic",serif',
            }}
          />

          {/* actions */}
          <div className="flex flex-wrap items-center gap-2">
            <button className={btn} onClick={() => void goTo(idx - 1)} disabled={idx === 0}>
              <ChevronLeft className="h-4 w-4" />
              Prev
            </button>
            <button
              className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
              onClick={() => void saveAndNext()}
            >
              <Save className="h-4 w-4" />
              Save &amp; Next
            </button>
            <button
              className={btn}
              onClick={() => void goTo(idx + 1)}
              disabled={idx >= total - 1}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
            <button className={btn} onClick={() => void jumpUnlabeled()}>
              <SkipForward className="h-4 w-4" />
              Next unlabeled
            </button>
            <button
              className="flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 transition hover:border-red-500 hover:text-red-400"
              onClick={() => void removeLine()}
            >
              <Trash2 className="h-4 w-4" />
              Bad line
            </button>
            <span className="ml-auto flex items-center gap-1.5 text-xs text-neutral-500">
              <Keyboard className="h-3.5 w-3.5" />
              Enter: save + next · Alt+↓ / Alt+↑: next / prev
            </span>
          </div>

          {/* thumbnails */}
          <div className="flex flex-wrap gap-1.5">
            {page.lines.map((l, k) => (
              <button
                key={l.i}
                onClick={() => void goTo(k)}
                className={`flex h-7 w-9 items-center justify-center rounded border text-xs transition ${
                  l.label.trim()
                    ? "border-emerald-600 bg-emerald-900/40 text-emerald-200"
                    : "border-neutral-700 bg-neutral-800 text-neutral-300"
                } ${k === idx ? "ring-2 ring-blue-500" : ""}`}
              >
                {l.i}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="rounded-lg border border-dashed border-neutral-700 p-6 text-sm text-neutral-400">
          No lines found on this page. Adjust the segmentation settings below and try again.
        </p>
      )}

      {children}
    </div>
  );
}