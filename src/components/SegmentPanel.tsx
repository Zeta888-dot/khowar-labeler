"use client";

import { useEffect, useState } from "react";
import { ApiError, getPage, overlayUrl, resegment, type SegParams } from "@/lib/api";
import { RefreshCw, RotateCw, SlidersHorizontal } from "lucide-react";

type Props = {
  pageId: string;
  /** bump to bust the overlay image cache */
  version: number;
  /** called after a successful re-segmentation (parent reloads the page) */
  onResegmented: () => void;
};

type NumKey = "sensitivity" | "minHeight" | "mergeGap" | "pad";

const SLIDERS: {
  key: NumKey;
  label: string;
  min: number;
  max: number;
  step: number;
  hint: string;
}[] = [
  {
    key: "sensitivity",
    label: "Sensitivity",
    min: 0.005,
    max: 0.15,
    step: 0.005,
    hint: "Lower value = faint dots and diacritics are included in the line",
  },
  {
    key: "minHeight",
    label: "Min line height (px)",
    min: 5,
    max: 80,
    step: 1,
    hint: "Detected lines smaller than this are dropped as noise",
  },
  {
    key: "mergeGap",
    label: "Merge gap (px)",
    min: 0,
    max: 40,
    step: 1,
    hint: "Joins nearby bands (increase if a line is splitting)",
  },
  {
    key: "pad",
    label: "Padding (px)",
    min: 0,
    max: 30,
    step: 1,
    hint: "Margin around each crop",
  },
];

export default function SegmentPanel({ pageId, version, onResegmented }: Props) {
  const [params, setParams] = useState<SegParams | null>(null);
  const [angle, setAngle] = useState(0);
  const [lineCount, setLineCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPage(pageId)
      .then((p) => {
        if (cancelled) return;
        setParams(p.params);
        setAngle(p.angle);
        setLineCount(p.lines.length);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [pageId, version]);

  async function run() {
    if (!params) return;
    setBusy(true);
    setError(null);
    try {
      try {
        await resegment(pageId, params, false);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          const ok = window.confirm(
            "All typed labels on this page will be deleted. Re-segment anyway?"
          );
          if (!ok) return;
          await resegment(pageId, params, true);
        } else {
          throw e;
        }
      }
      onResegmented();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-neutral-100">
      <summary className="flex cursor-pointer items-center gap-2 text-sm text-neutral-300">
        <SlidersHorizontal className="h-4 w-4" />
        Segmentation check &amp; re-segment
      </summary>

      <div className="mt-4 space-y-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={overlayUrl(pageId, version)}
          alt="segmentation overlay"
          className="max-w-full rounded-md border border-neutral-800"
        />

        <p className="text-xs text-neutral-400">
          {lineCount} lines detected · skew corrected by {angle.toFixed(2)}°
        </p>

        {error && (
          <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
        )}

        {params ? (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={params.deskew}
                onChange={(e) => setParams({ ...params, deskew: e.target.checked })}
              />
              <RotateCw className="h-4 w-4 text-neutral-400" />
              Deskew (straighten tilted scans)
            </label>

            {SLIDERS.map((s) => (
              <div key={s.key}>
                <div className="flex items-center justify-between text-sm">
                  <span>{s.label}</span>
                  <span className="tabular-nums text-neutral-400">{params[s.key]}</span>
                </div>
                <input
                  type="range"
                  min={s.min}
                  max={s.max}
                  step={s.step}
                  value={params[s.key]}
                  onChange={(e) => setParams({ ...params, [s.key]: Number(e.target.value) })}
                  className="w-full"
                />
                <p className="text-xs text-neutral-500">{s.hint}</p>
              </div>
            ))}

            <div className="flex items-center gap-3">
              <button
                onClick={() => void run()}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
                {busy ? "Working…" : "Re-segment this page"}
              </button>
              <span className="text-xs text-neutral-500">
                Labels are wiped on re-segment, so tune settings before typing.
              </span>
            </div>
          </>
        ) : (
          <p className="text-sm text-neutral-400">Loading settings…</p>
        )}
      </div>
    </details>
  );
}