import { initials } from "@/lib/hexaro";
import { cn } from "@/lib/utils";

export type AvatarDef = {
  id: string;
  src: string;
  aliases: string[];
};

const modules = {
  ...import.meta.glob("../../icon_Netlifx/*.{png,jpg,jpeg,webp,gif}", {
    eager: true,
    query: "?url",
    import: "default",
  }),
  ...import.meta.glob("../../icon_netflix/*.{png,jpg,jpeg,webp,gif}", {
    eager: true,
    query: "?url",
    import: "default",
  }),
} as Record<string, string>;

function fileName(path: string) {
  return path.split("/").pop() ?? path;
}

function slugId(name: string) {
  return name
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "icon";
}

function classicIndex(name: string) {
  const n = name.toLowerCase();
  if (n === "image.png") return 0;
  if (n === "image copy.png") return 1;
  const m = n.match(/^image copy (\d+)\.png$/);
  if (m) return Number(m[1]);
  return null;
}

const entries = Object.entries(modules).sort((a, b) => {
  const ia = classicIndex(fileName(a[0]));
  const ib = classicIndex(fileName(b[0]));
  if (ia !== null && ib !== null) return ia - ib;
  if (ia !== null) return -1;
  if (ib !== null) return 1;
  return fileName(a[0]).localeCompare(fileName(b[0]), "fr");
});

export const PROFILE_AVATARS: AvatarDef[] = entries.map(([path, src], i) => {
  const name = fileName(path);
  const id = slugId(name);
  const aliases = [id, String(i).padStart(2, "0")];
  return { id, src, aliases };
});

export function avatarSrc(id?: string | null) {
  if (!id) return null;
  if (/^(https?:)?\/\//.test(id) || id.startsWith("/") || id.includes("..")) return null;
  const found = PROFILE_AVATARS.find((a) => a.id === id || a.aliases.includes(id));
  return found?.src ?? null;
}

export function ProfileAvatar({
  id,
  name,
  className,
}: {
  id?: string | null;
  name?: string | null;
  className?: string;
}) {
  const src = avatarSrc(id);
  if (src) {
    return (
      <img
        src={src}
        alt={name ? `Icône de ${name}` : "Icône de profil"}
        className={cn("rounded-xl object-cover shadow-lg", className)}
      />
    );
  }
  return (
    <div className={cn("rounded-xl grid place-items-center bg-[#E50914] text-white font-bold shadow-lg", className)}>
      {initials(name).slice(0, 1)}
    </div>
  );
}

export function AvatarGrid({
  selected,
  onPick,
  accent = "brand",
}: {
  selected?: string | null;
  onPick: (id: string) => void;
  accent?: "brand" | "netflix";
}) {
  const ring = accent === "netflix" ? "ring-[#E50914]" : "ring-brand";
  return (
    <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
      {PROFILE_AVATARS.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onPick(a.id)}
          className={cn(
            "rounded-xl ring-offset-background hover:scale-105 transition",
            selected === a.id || a.aliases.includes(selected ?? "") ? `ring-2 ${ring}` : "ring-0",
          )}
        >
          <ProfileAvatar id={a.id} className="h-16 w-16 sm:h-[4.5rem] sm:w-[4.5rem]" />
        </button>
      ))}
    </div>
  );
}
