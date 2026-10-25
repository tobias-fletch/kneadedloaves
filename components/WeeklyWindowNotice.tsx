import { describeWeeklyWindow, type WeeklyResolution } from "@/lib/weekly-window";

/** The weekly order window in one line (homepage hero, menu header and checkout). Server-safe, no hooks. */
export function WeeklyWindowNotice({ resolution, full = false, variant }: { resolution: WeeklyResolution; full?: boolean; variant: "hero" | "inline" | "checkout" }) {
  const { headline, detail } = describeWeeklyWindow(resolution);
  const text = full ? "This week's orders are full. Thank you!" : headline;
  if (variant === "hero") {
    return (
      <div data-testid="weekly-window">
        <p className="font-display mt-1 text-2xl uppercase tracking-wide">{text}</p>
        {detail ? <p className="mt-1 text-sm font-semibold text-ink/80">{detail}</p> : null}
      </div>
    );
  }
  if (variant === "checkout") {
    return (
      <div className="border-2 border-ink bg-crumb p-3" data-testid="weekly-window" role="status">
        <p className="text-xs font-black uppercase tracking-widest text-ink/70">Order window</p>
        <p className="mt-1 text-sm font-black">{text}</p>
        {detail ? <p className="mt-1 text-sm font-medium text-ink/80">{detail}</p> : null}
      </div>
    );
  }
  return (
    <div data-testid="weekly-window">
      <p className="text-sm font-medium text-ink/70">{text}</p>
      {detail ? <p className="text-sm font-semibold text-ink/80">{detail}</p> : null}
    </div>
  );
}
