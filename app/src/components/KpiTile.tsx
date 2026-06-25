import clsx from "clsx";
import type { KpiTile as KpiTileT } from "@/lib/types";

const toneColor = {
  neutral: "text-ink-100",
  good: "text-good",
  warn: "text-warn",
  bad: "text-bad",
};

export default function KpiTile({ tile }: { tile: KpiTileT }) {
  return (
    <div className="bg-bone-0 border border-bone-300 rounded-lg p-4">
      <div className="text-xs uppercase tracking-wide text-ink-300 font-semibold">{tile.label}</div>
      <div className={clsx("text-2xl font-bold mt-2", toneColor[tile.tone ?? "neutral"])}>
        {tile.value}
      </div>
      {tile.delta && <div className="text-xs text-ink-300 mt-1">{tile.delta}</div>}
    </div>
  );
}
