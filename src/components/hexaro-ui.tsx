import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: any;
  tone?: "default" | "brand" | "success" | "warning" | "destructive";
  className?: string;
}) {
  const toneStyle: Record<string, string> = {
    default: "text-foreground",
    brand: "hex-gradient-text",
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
  };
  const iconTone: Record<string, string> = {
    default: "text-muted-foreground",
    brand: "text-brand",
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
  };
  return (
    <div className={cn("hex-glass rounded-2xl p-5 relative overflow-hidden transition-all hover:border-brand/40", className)}>
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">{label}</p>
      <div className="flex items-center gap-2.5">
        {Icon && <Icon className={cn("h-5 w-5 shrink-0", iconTone[tone])} />}
        <p className={cn("text-2xl sm:text-3xl font-bold tracking-tight", toneStyle[tone])}>{value}</p>
      </div>
      {hint && <p className="text-xs text-muted-foreground mt-2">{hint}</p>}
    </div>
  );
}

export function IconStat({
  icon: Icon,
  tone = "muted",
  children,
}: {
  icon: any;
  tone?: "muted" | "brand" | "success" | "warning" | "destructive";
  children: ReactNode;
}) {
  const map: Record<string, string> = {
    muted: "text-muted-foreground",
    brand: "text-brand",
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className={cn("h-3.5 w-3.5", map[tone])} />
      {children}
    </span>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatusPill({ tone, children }: { tone: "success" | "warning" | "destructive" | "muted"; children: ReactNode }) {
  const map: Record<string, string> = {
    success: "bg-success/15 text-success border-success/25",
    warning: "bg-warning/15 text-warning border-warning/25",
    destructive: "bg-destructive/15 text-destructive border-destructive/25",
    muted: "bg-muted text-muted-foreground border-border",
  };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium", map[tone])}>
      <span className={cn("h-1.5 w-1.5 rounded-full", {
        "bg-success": tone === "success",
        "bg-warning": tone === "warning",
        "bg-destructive": tone === "destructive",
        "bg-muted-foreground": tone === "muted",
      })} />
      {children}
    </span>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="hex-glass rounded-2xl p-12 text-center">
      <h3 className="text-lg font-semibold">{title}</h3>
      {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
