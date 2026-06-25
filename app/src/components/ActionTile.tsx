import Link from "next/link";
import clsx from "clsx";
import type { ActionTile as ActionTileT } from "@/lib/types";

const toneText = {
  neutral: "text-ink-100",
  good: "text-good",
  warn: "text-warn",
  bad: "text-bad",
  accent: "text-accent",
};

const toneBorder = {
  neutral: "border-bone-300 hover:border-ink-300",
  good:    "border-good/40 hover:border-good",
  warn:    "border-warn/40 hover:border-warn",
  bad:     "border-bad/40 hover:border-bad",
  accent:  "border-accent/40 hover:border-accent",
};

export default function ActionTile({ tile }: { tile: ActionTileT }) {
  const tone = tile.tone ?? "neutral";
  const body = (
    <div className={clsx(
      "bg-bone-0 border rounded-lg p-4 transition cursor-pointer h-full",
      toneBorder[tone]
    )}>
      <div className="text-[11px] uppercase tracking-wide text-ink-300 font-semibold">{tile.label}</div>
      <div className={clsx("text-2xl font-bold mt-2", toneText[tone])}>{tile.value}</div>
      {tile.subtitle && <div className="text-xs text-ink-300 mt-1">{tile.subtitle}</div>}
    </div>
  );
  return tile.href ? <Link href={tile.href}>{body}</Link> : body;
}
