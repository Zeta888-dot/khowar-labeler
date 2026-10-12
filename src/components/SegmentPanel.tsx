"use client";

import { useEffect, useState } from "react";
import { ApiError, getPage, overlayUrl, resegment, type SegParams } from "@/lib/api";

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
    hint: "Kam value = halke nuqtay / harkaat bhi line mein shamil",
  },
  {
    key: "minHeight",
    label: "Min line height (px)",
    min: 5,
    max: 80,
    step: 1,
    hint: "Isse chhoti detected lines drop ho jati hain (noise)",
  },
  {
    key: "mergeGap",
    label: "Merge gap (px)",
    min: 0,
    max: 40,
    step: 1,
    hint: "Nazdeek bands ko jodta hai (line split ho rahi ho to barhao)",
  },
  {
    key: "pad",
    label: "Padding (px)",
    min: 0,
    max: 30,
    step: 1,
    hint: "Har crop ke ird-gird margin",
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
            "Is page ke saare typed labels delete ho jayenge. Phir bhi re-segment karna hai?"
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
      <summary className="cursor-pointer text-sm text-neutral-300">
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
              Deskew (tilted scan seedha karo)
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
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
              >
                {busy ? "Working…" : "Re-segment this page"}
              </button>
              <span className="text-xs text-neutral-500">
                Labels wipe ho jate hain, to typing se pehle settings tune kar lo.
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