import { Hexagon } from "lucide-react";
import { cn } from "@/lib/utils";

export function HexaroLogo({ className, showText = true, size = 32 }: { className?: string; showText?: boolean; size?: number }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div
        className="relative grid place-items-center rounded-xl hex-gradient hex-glow"
        style={{ width: size, height: size }}
      >
        <Hexagon className="text-brand-foreground" strokeWidth={2.5} style={{ width: size * 0.55, height: size * 0.55 }} />
      </div>
      {showText && (
        <span className="text-lg font-bold tracking-tight">
          Hex<span className="hex-gradient-text">aro</span>
        </span>
      )}
    </div>
  );
}
