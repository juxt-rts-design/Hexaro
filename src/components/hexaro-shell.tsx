import { useState, type ReactNode } from "react";
import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  Film,
  Music2,
  Wifi,
  Package,
  UserCog,
  History,
  LogOut,
  Menu,
  Bell,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { HexaroLogo } from "@/components/hexaro-logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initials } from "@/lib/hexaro";
import { toast } from "sonner";

const NAV = [
  { to: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { to: "/clients", label: "Clients", icon: Users },
  { to: "/netflix", label: "Netflix", icon: Film },
  { to: "/spotify", label: "Spotify", icon: Music2 },
  { to: "/internet", label: "Internet", icon: Wifi },
  { to: "/services", label: "Services", icon: Package },
  { to: "/activity", label: "Journal", icon: History },
] as const;

const ADMIN_NAV = [{ to: "/team", label: "Équipe", icon: UserCog }] as const;

export function HexaroShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, isAdmin, roles } = useAuth();
  const navigate = useNavigate();

  const displayName = user?.user_metadata?.full_name ?? user?.email ?? "";

  async function handleSignOut() {
    await supabase.auth.signOut();
    toast.success("Déconnecté");
    navigate({ to: "/auth", replace: true });
  }

  const nav = (
    <NavContent pathname={pathname} isAdmin={isAdmin} onNavigate={() => setMobileOpen(false)} />
  );

  return (
    <div className="min-h-screen w-full text-foreground">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-30 w-64 flex-col border-r border-sidebar-border bg-sidebar/70 backdrop-blur-xl">
        <div className="flex h-16 items-center px-5 border-b border-sidebar-border">
          <HexaroLogo />
        </div>
        {nav}
        <UserFooter displayName={displayName} email={user?.email ?? ""} roles={roles} onSignOut={handleSignOut} />
      </aside>

      {/* Mobile sheet */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 p-0 bg-sidebar border-sidebar-border">
          <div className="flex h-16 items-center px-5 border-b border-sidebar-border">
            <HexaroLogo />
          </div>
          {nav}
          <UserFooter displayName={displayName} email={user?.email ?? ""} roles={roles} onSignOut={handleSignOut} />
        </SheetContent>
      </Sheet>

      {/* Main */}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/70 backdrop-blur-xl px-4 sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Ouvrir le menu">
            <Menu className="h-5 w-5" />
          </Button>
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="search"
              placeholder="Rechercher un client, un profil…"
              className="w-full h-9 rounded-lg bg-muted/40 border border-border pl-9 pr-3 text-sm outline-none focus:border-brand transition"
            />
          </div>
          <Button variant="ghost" size="icon" aria-label="Notifications">
            <Bell className="h-5 w-5" />
          </Button>
        </header>
        <main className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto">{children}</main>
      </div>
    </div>
  );
}

function NavContent({ pathname, isAdmin, onNavigate }: { pathname: string; isAdmin: boolean; onNavigate: () => void }) {
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
      <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Général</p>
      {NAV.map((item) => (
        <NavLink key={item.to} to={item.to} icon={item.icon} label={item.label} active={pathname === item.to || pathname.startsWith(item.to + "/")} onNavigate={onNavigate} />
      ))}
      {isAdmin && (
        <>
          <p className="px-3 mt-6 mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Administration</p>
          {ADMIN_NAV.map((item) => (
            <NavLink key={item.to} to={item.to} icon={item.icon} label={item.label} active={pathname.startsWith(item.to)} onNavigate={onNavigate} />
          ))}
        </>
      )}
    </nav>
  );
}

function NavLink({ to, icon: Icon, label, active, onNavigate }: { to: string; icon: any; label: string; active: boolean; onNavigate: () => void }) {
  return (
    <Link
      to={to}
      onClick={onNavigate}
      className={cn(
        "group flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--brand)_35%,transparent)]"
          : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0 transition", active ? "text-brand" : "group-hover:text-foreground")} />
      <span>{label}</span>
      {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand shadow-[0_0_8px_var(--brand)]" />}
    </Link>
  );
}

function UserFooter({ displayName, email, roles, onSignOut }: { displayName: string; email: string; roles: string[]; onSignOut: () => void }) {
  return (
    <div className="border-t border-sidebar-border p-3">
      <div className="flex items-center gap-3 px-2 py-2">
        <Avatar className="h-9 w-9 border border-sidebar-border">
          <AvatarFallback className="bg-brand-soft text-brand-foreground text-xs font-semibold">{initials(displayName || email)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{displayName || "Utilisateur"}</p>
          <p className="text-[11px] text-muted-foreground truncate">
            {roles.length ? roles.map((r) => (r === "admin" ? "Administrateur" : "Manager")).join(" · ") : email}
          </p>
        </div>
      </div>
      <Button variant="ghost" size="sm" className="w-full justify-start gap-2 mt-1 text-muted-foreground hover:text-foreground" onClick={onSignOut}>
        <LogOut className="h-4 w-4" />
        Déconnexion
      </Button>
    </div>
  );
}
