// Helpers métier partagés (calcul d'expiration, format monétaire, etc.)

export type ExpirationInfo = {
  expiresAt: Date;
  msRemaining: number;
  days: number;
  hours: number;
  minutes: number;
  status: "active" | "soon" | "expired";
  label: string;
  tone: "success" | "warning" | "destructive";
};

export function computeExpiration(startDate: string | Date | null | undefined, durationDays: number | null | undefined): ExpirationInfo {
  const start = startDate ? new Date(startDate) : new Date();
  const dur = durationDays ?? 30;
  const expiresAt = new Date(start.getTime() + dur * 24 * 60 * 60 * 1000);
  const now = Date.now();
  const msRemaining = expiresAt.getTime() - now;
  const totalMinutes = Math.max(0, Math.floor(msRemaining / 60000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  let status: ExpirationInfo["status"] = "active";
  let tone: ExpirationInfo["tone"] = "success";
  let label = `${days}j ${hours}h ${minutes}min`;

  if (msRemaining <= 0) {
    status = "expired";
    tone = "destructive";
    label = "Expiré";
  } else if (days < 3) {
    status = "soon";
    tone = "warning";
  }

  return { expiresAt, msRemaining, days, hours, minutes, status, label, tone };
}

export function formatMoney(n: number | string | null | undefined): string {
  const num = typeof n === "string" ? parseFloat(n) : (n ?? 0);
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(num) + " F";
}

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(d));
}

export function formatDateTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
