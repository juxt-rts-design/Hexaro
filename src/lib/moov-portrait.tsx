import { initials } from "@/lib/hexaro";
import { cn } from "@/lib/utils";

const TONES = [
  { from: "#FF6A00", to: "#FF9A3D" },
  { from: "#00A2FF", to: "#0B4F8A" },
  { from: "#0B3A6A", to: "#00C2FF" },
  { from: "#FF8C00", to: "#7A2E00" },
  { from: "#1A6BFF", to: "#041E3A" },
  { from: "#FFC107", to: "#FF6A00" },
];

function toneOf(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i) * (i + 1)) % TONES.length;
  return TONES[h] ?? TONES[0]!;
}

export function MoovPortrait({
  name,
  active,
  className,
}: {
  name: string;
  active?: boolean;
  className?: string;
}) {
  const tone = toneOf(name || "?");
  const letter = initials(name).slice(0, 1);
  return (
    <div
      className={cn("relative overflow-hidden rounded-2xl shadow-lg", className)}
      style={{
        background: `linear-gradient(145deg, ${tone.from}, ${tone.to})`,
        boxShadow: active ? "0 0 22px rgba(255,106,0,0.35)" : undefined,
      }}
    >
      <div className="absolute inset-0 opacity-30" style={{ background: "radial-gradient(circle at 30% 20%, #fff, transparent 45%)" }} />
      <svg viewBox="0 0 80 80" className="absolute right-1 top-1 h-5 w-5 opacity-70" aria-hidden>
        <rect x="8" y="18" width="64" height="44" rx="6" fill="none" stroke="#fff" strokeWidth="4" />
        <rect x="22" y="30" width="20" height="20" rx="3" fill="#fff" />
      </svg>
      <span className="relative grid h-full w-full place-items-center text-3xl font-black text-white drop-shadow">
        {letter}
      </span>
    </div>
  );
}
