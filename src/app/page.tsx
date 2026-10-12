"use client";

import { useCallback, useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import Workspace from "@/components/Workspace";
import SegmentPanel from "@/components/SegmentPanel";
import { listPages, type PageSummary } from "@/lib/api";

export default function Home() {
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // bump after resegment: reloads page data + busts image caches
  const [version, setVersion] = useState(0);

  const refreshPages = useCallback(async () => {
    try {
      setPages(await listPages());
    } catch (e) {
      console.error("listPages failed", e);
    }
  }, []);

  useEffect(() => {
    void refreshPages();
  }, [refreshPages]);

  return (
    <div className="flex h-screen bg-neutral-950">
      <Sidebar
        pages={pages}
        activeId={activeId}
        onSelect={setActiveId}
        onUploaded={(created) => {
          void refreshPages();
          if (created.length) setActiveId(created[0]);
        }}
      />

      <main className="flex-1 overflow-y-auto">
        {activeId ? (
          <Workspace
            key={activeId}
            pageId={activeId}
            version={version}
            onChanged={() => void refreshPages()}
            onPageDeleted={() => {
              setActiveId(null);
              void refreshPages();
            }}
          >
            <SegmentPanel
              pageId={activeId}
              version={version}
              onResegmented={() => {
                setVersion((v) => v + 1);
                void refreshPages();
              }}
            />
          </Workspace>
        ) : (
          <div className="flex h-full items-center justify-center text-neutral-500">
            Pehle ek scan upload karo ya list se page chuno 👈
          </div>
        )}
      </main>
    </div>
  );
}