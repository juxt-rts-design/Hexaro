import { initials } from "@/lib/hexaro";
import { cn } from "@/lib/utils";

export function SpotifyPortrait({
  name,
  active,
  className,
}: {
  name: string;
  active?: boolean;
  className?: string;
}) {
  const letter = initials(name).slice(0, 1);
  return (
    <div
      className={cn("relative overflow-hidden rounded-full", className)}
      style={{
        background: active ? "#1DB954" : "#1a1a1a",
        boxShadow: active ? "0 0 18px rgba(29,185,84,0.4)" : "inset 0 0 0 2px #1DB954",
      }}
    >
      <svg viewBox="0 0 24 24" className="absolute inset-[18%] opacity-20" aria-hidden>
        <path d="M6.5 15.2c3.2-1.6 6.9-2 10.8-1.1M6.2 11.4c3.7-1.8 8.1-2.3 12.6-1.2M6 7.7c4.2-2 9.3-2.6 14.4-1.3" fill="none" stroke="#000" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
      <span className={cn("relative grid h-full w-full place-items-center text-2xl font-black", active ? "text-black" : "text-[#1DB954]")}>
        {letter}
      </span>
    </div>
  );
}
