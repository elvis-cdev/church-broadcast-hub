import { useMemo } from "react";

type Props = {
  levelDb: number;
  peakDb: number;
};

/** Vertical-style stacked bars indicating audio level. */
export function AudioMeter({ levelDb, peakDb }: Props) {
  const segments = 24;
  const min = -60;
  const max = 0;
  const activeIndex = useMemo(() => {
    const ratio = (levelDb - min) / (max - min);
    return Math.round(ratio * segments);
  }, [levelDb]);
  const peakIndex = useMemo(() => {
    const ratio = (peakDb - min) / (max - min);
    return Math.round(ratio * segments);
  }, [peakDb]);

  return (
    <div className="flex items-end gap-[3px] h-24">
      {Array.from({ length: segments }).map((_, i) => {
        const segDb = min + ((max - min) * (i + 1)) / segments;
        const isActive = i < activeIndex;
        const isPeak = i === peakIndex - 1;
        let color = "bg-success";
        if (segDb > -12) color = "bg-primary";
        if (segDb > -3) color = "bg-destructive";
        return (
          <div
            key={i}
            className={[
              "w-1.5 rounded-sm transition-opacity",
              isActive || isPeak ? color : "bg-muted",
              isActive ? "opacity-100" : "opacity-30",
              isPeak && !isActive ? "opacity-90" : "",
            ].join(" ")}
            style={{ height: `${((i + 1) / segments) * 100}%` }}
          />
        );
      })}
    </div>
  );
}
