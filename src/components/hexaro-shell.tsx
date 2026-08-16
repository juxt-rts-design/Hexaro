import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouter, useRouterState, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Package,
  UserCog,
  History,
  FolderOpen,
  FileBarChart,
  LogOut,
  Menu,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useMyProfile } from "@/hooks/useAuth";
import { HexaroLogo } from "@/components/hexaro-logo";
import { toast } from "sonner";
import { NotificationsBell } from "@/components/notifications-bell";
import { useServices, servicePath, serviceIcon } from "@/lib/services";
import { ClientSearchBar, ClientSearchProvider } from "@/components/client-search";
import { HexaroBot } from "@/components/hexaro-bot";
import { prefetchWorkspace, prefetchPath, prefetchCustomService, preloadAppRoutes } from "@/lib/prefetch";
import { ProfileAvatar } from "@/lib/netflix-avatars";

const TOP_NAV = [{ to: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard }] as const;

const TOOL_NAV = [
  { to: "/services", label: "Catalogue", icon: Package, adminOnly: true },
  { to: "/media", label: "Médias", icon: FolderOpen },
  { to: "/reports", label: "Fiches & Rapports", icon: FileBarChart },
  { to: "/activity", label: "Journal", icon: History, adminOnly: true },
] as const;

const ADMIN_NAV = [{ to: "/team", label: "Équipe", icon: UserCog }] as const;

export function HexaroShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopOpen, setDesktopOpen] = useState(true);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, isAdmin, roles } = useAuth();
  const { data: me } = useMyProfile();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { data: services = [] } = useServices();

  useEffect(() => {
    prefetchWorkspace(queryClient);
    preloadAppRoutes(router, services);
  }, [queryClient, router, services]);

  const displayName = me?.full_name || user?.user_metadata?.full_name || user?.email || "";
  const avatarId = me?.avatar_url ?? null;

  async function handleSignOut() {
    await supabase.auth.signOut();
    toast.success("Déconnecté");
    navigate({ to: "/auth", replace: true });
  }

  const nav = (
    <NavContent pathname={pathname} isAdmin={isAdmin} onNavigate={() => setMobileOpen(false)} />
  );

  return (
    <ClientSearchProvider>
    <div className="min-h-screen w-full text-foreground">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden lg:flex fixed inset-y-0 left-0 z-30 w-64 flex-col border-r border-sidebar-border bg-sidebar/70 backdrop-blur-xl transition-transform duration-300",
          desktopOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-16 items-center px-5 border-b border-sidebar-border">
          <HexaroLogo />
        </div>
        {nav}
        <UserFooter displayName={displayName} email={user?.email ?? ""} roles={roles} avatarId={avatarId} onSignOut={handleSignOut} />
      </aside>

      {/* Mobile sheet */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 p-0 bg-sidebar border-sidebar-border">
          <div className="flex h-16 items-center px-5 border-b border-sidebar-border">
            <HexaroLogo />
          </div>
          {nav}
          <UserFooter displayName={displayName} email={user?.email ?? ""} roles={roles} avatarId={avatarId} onSignOut={handleSignOut} />
        </SheetContent>
      </Sheet>

      {/* Main */}
      <div className={cn("transition-[padding] duration-300", desktopOpen ? "lg:pl-64" : "lg:pl-0")}>
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/70 backdrop-blur-xl px-4 sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Ouvrir le menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:inline-flex"
            onClick={() => setDesktopOpen((v) => !v)}
            aria-label="Basculer le menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <ClientSearchBar />
          <NotificationsBell />
          <Link to="/profile" className="ml-1">
            <ProfileAvatar id={avatarId} name={displayName} className="h-8 w-8 rounded-full text-xs cursor-pointer hover:ring-2 hover:ring-brand transition" />
          </Link>
        </header>
        <main className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto">{children}</main>
      </div>
      <HexaroBot />
    </div>
    </ClientSearchProvider>
  );
}

function NavContent({ pathname, isAdmin, onNavigate }: { pathname: string; isAdmin: boolean; onNavigate: () => void }) {
  const { data: services = [] } = useServices();

  return (
    <nav className="flex-1 overflow-y-auto scrollbar-none px-3 py-4 space-y-1">
      <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Général</p>
      {TOP_NAV.map((item) => (
        <NavLink key={item.to} to={item.to} icon={item.icon} label={item.label} active={pathname === item.to} onNavigate={onNavigate} />
      ))}
      <p className="px-3 mt-6 mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Services</p>
      {services.map((s) => {
        const to = servicePath(s.slug);
        const active = pathname === to || pathname.startsWith(`${to}/`);
        return (
          <NavLink
            key={s.id}
            to={to}
            slug={s.is_builtin ? undefined : s.slug}
            icon={serviceIcon(s.slug)}
            label={s.name}
            active={active}
            onNavigate={onNavigate}
          />
        );
      })}
      <p className="px-3 mt-6 mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Outils</p>
      {TOOL_NAV.filter((item) => !("adminOnly" in item && item.adminOnly) || isAdmin).map((item) => (
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

function NavLink({
  to,
  slug,
  icon: Icon,
  label,
  active,
  onNavigate,
}: {
  to: string;
  slug?: string;
  icon: any;
  label: string;
  active: boolean;
  onNavigate: () => void;
}) {
  const queryClient = useQueryClient();
  const className = cn(
    "group flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all",
    active
      ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--brand)_35%,transparent)]"
      : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50",
  );
  const inner = (
    <>
      <Icon className={cn("h-4 w-4 shrink-0 transition", active ? "text-brand" : "group-hover:text-foreground")} />
      <span className="truncate">{label}</span>
      {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand shadow-[0_0_8px_var(--brand)]" />}
    </>
  );

  function warm() {
    if (slug) prefetchCustomService(queryClient, slug);
    else prefetchPath(queryClient, to);
  }

  if (slug) {
    return (
      <Link
        to="/s/$slug"
        params={{ slug }}
        preload="intent"
        onClick={onNavigate}
        onPointerEnter={warm}
        onFocus={warm}
        className={className}
      >
        {inner}
      </Link>
    );
  }

  return (
    <Link
      to={to as "/dashboard"}
      preload="intent"
      onClick={onNavigate}
      onPointerEnter={warm}
      onFocus={warm}
      className={className}
    >
      {inner}
    </Link>
  );
}

function UserFooter({ displayName, email, roles, avatarId, onSignOut }: { displayName: string; email: string; roles: string[]; avatarId?: string | null; onSignOut: () => void }) {
  return (
    <div className="border-t border-sidebar-border p-3">
      <Link to="/profile" className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-sidebar-accent/50 transition group">
        <ProfileAvatar id={avatarId} name={displayName || email} className="h-9 w-9 text-xs" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate group-hover:text-brand transition">{displayName || "Utilisateur"}</p>
          <p className="text-[11px] text-muted-foreground truncate">
            {roles.length ? roles.map((r) => (r === "admin" ? "Administrateur" : "Manager")).join(" · ") : "Mon espace"}
          </p>
        </div>
        <User className="h-4 w-4 text-muted-foreground group-hover:text-brand shrink-0" />
      </Link>
      <Button variant="ghost" size="sm" className="w-full justify-start gap-2 mt-1 text-muted-foreground hover:text-foreground" onClick={onSignOut}>
        <LogOut className="h-4 w-4" />
        Déconnexion
      </Button>
    </div>
  );
}
