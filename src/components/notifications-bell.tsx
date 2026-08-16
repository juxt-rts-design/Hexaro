import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  DEFAULT_NOTIF_SETTINGS,
  parseNotifSettings,
  settingsPayload,
  shouldToast,
  type NotifSettings,
} from "@/lib/notification-prefs";

const SIGNIN_WINDOW_MS = 3 * 60_000;
const toastedKeys = new Set<string>();

type Notif = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  created_at: string;
  read_at: string | null;
  recipient_id: string | null;
  actor_id?: string | null;
};

function fromSignInLog(row: {
  id: string;
  actor_email: string | null;
  actor_id: string | null;
  created_at: string;
  metadata: unknown;
}): Notif {
  const meta = row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {};
  const name = typeof meta.full_name === "string" && meta.full_name.trim() ? meta.full_name : row.actor_email ?? "Un utilisateur";
  const admin = meta.admin === true;
  return {
    id: `log:${row.id}`,
    type: "user.signin",
    title: admin ? "Connexion administrateur" : "Connexion d'un manager",
    body: `${name} vient de se connecter`,
    created_at: row.created_at,
    read_at: null,
    recipient_id: null,
    actor_id: row.actor_id,
  };
}

function notifKey(n: Notif): string {
  if (n.type === "user.signin" && n.actor_id) {
    const bucket = Math.floor(new Date(n.created_at).getTime() / SIGNIN_WINDOW_MS);
    return `signin:${n.actor_id}:${bucket}`;
  }
  if (n.type === "user.created" && n.body) {
    const bucket = Math.floor(new Date(n.created_at).getTime() / SIGNIN_WINDOW_MS);
    return `created:${n.body}:${bucket}`;
  }
  return n.id;
}

function dedupeNotifs(list: Notif[]): Notif[] {
  const seen = new Set<string>();
  const out: Notif[] = [];
  for (const n of list) {
    const key = notifKey(n);
    if (seen.has(n.id) || seen.has(key)) continue;
    seen.add(n.id);
    seen.add(key);
    out.push(n);
  }
  return out;
}

export function NotificationsBell() {
  const { user, isAdmin, loading } = useAuth();
  const [items, setItems] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<NotifSettings>(DEFAULT_NOTIF_SETTINGS);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const primedRef = useRef(false);
  const seenKeysRef = useRef(new Set<string>());

  const userId = user?.id;

  useEffect(() => {
    if (loading || !userId) return;
    let mounted = true;
    primedRef.current = false;
    seenKeysRef.current = new Set();

    const applyRead = (list: Notif[], readIds = prefsRef.current.read_ids) => {
      const seen = new Set(readIds);
      return list.map((n) => (seen.has(n.id) || seen.has(notifKey(n)) ? { ...n, read_at: n.read_at ?? "local" } : n));
    };

    const remember = (n: Notif) => {
      seenKeysRef.current.add(n.id);
      seenKeysRef.current.add(notifKey(n));
    };

    const mergeIncoming = (incoming: Notif, toastIfNew: boolean) => {
      const key = notifKey(incoming);
      if (seenKeysRef.current.has(incoming.id) || seenKeysRef.current.has(key)) return;
      remember(incoming);
      setItems((prev) => applyRead([incoming, ...prev.filter((x) => x.id !== incoming.id && notifKey(x) !== key)]).slice(0, 30));
      if (!toastIfNew || !primedRef.current) return;
      if (!shouldToast(incoming.type, prefsRef.current)) return;
      if (toastedKeys.has(key)) return;
      toastedKeys.add(key);
      toast(incoming.title, { id: key, description: incoming.body ?? undefined });
    };

    const load = async () => {
      const notifFilter = isAdmin
        ? `recipient_id.eq.${userId},recipient_id.is.null`
        : `recipient_id.eq.${userId}`;

      const [{ data: notifs }, { data: logs }, { data: profile }] = await Promise.all([
        supabase
          .from("notifications")
          .select("id,type,title,body,created_at,read_at,recipient_id")
          .or(notifFilter)
          .order("created_at", { ascending: false })
          .limit(30),
        isAdmin
          ? supabase
              .from("activity_logs")
              .select("id, actor_email, actor_id, created_at, metadata")
              .eq("action", "user.signin")
              .order("created_at", { ascending: false })
              .limit(30)
          : Promise.resolve({ data: [] as never[] }),
        supabase.from("profiles").select("settings").eq("id", userId).maybeSingle(),
      ]);
      if (!mounted) return;

      const parsed = parseNotifSettings(profile?.settings);
      setPrefs(parsed);

      const fromDb = ((notifs ?? []) as Notif[]).filter((n) => {
        if (n.recipient_id === userId) return true;
        return isAdmin && n.recipient_id === null;
      });
      const fromLogs = ((logs ?? []) as Parameters<typeof fromSignInLog>[0][])
        .filter((row) => row.actor_id !== userId)
        .map(fromSignInLog);

      const combined = dedupeNotifs(
        [...fromDb, ...fromLogs].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)),
      ).slice(0, 30);
      seenKeysRef.current = new Set();
      for (const n of combined) remember(n);
      setItems(applyRead(combined, parsed.read_ids));
      primedRef.current = true;
    };

    void load();

    const channel = supabase
      .channel(`hexaro-inbox:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        (payload) => {
          const n = payload.new as Notif;
          const forMe = n.recipient_id === userId || (n.recipient_id === null && isAdmin);
          if (!forMe) return;
          mergeIncoming(n, true);
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "activity_logs" },
        (payload) => {
          const row = payload.new as {
            id: string;
            action?: string;
            actor_email: string | null;
            actor_id: string | null;
            created_at: string;
            metadata: unknown;
          };
          if (row.action !== "user.signin" || !isAdmin || row.actor_id === userId) return;
          mergeIncoming(fromSignInLog(row), true);
        },
      )
      .subscribe();

    const poll = window.setInterval(() => {
      if (!isAdmin) return;
      void supabase
        .from("activity_logs")
        .select("id, actor_email, actor_id, created_at, metadata")
        .eq("action", "user.signin")
        .order("created_at", { ascending: false })
        .limit(10)
        .then(({ data }) => {
          for (const row of data ?? []) {
            if (row.actor_id === userId) continue;
            mergeIncoming(fromSignInLog(row), false);
          }
        });
    }, 20_000);

    return () => {
      mounted = false;
      window.clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [userId, loading, isAdmin]);

  const unread = items.filter((i) => !i.read_at).length;

  async function persistReadIds(nextIds: string[]) {
    if (!userId) return;
    const next = settingsPayload({ ...prefsRef.current, read_ids: nextIds });
    setPrefs(next);
    prefsRef.current = next;
    const { data } = await supabase.from("profiles").select("settings").eq("id", userId).maybeSingle();
    const current = data?.settings && typeof data.settings === "object" ? (data.settings as Record<string, unknown>) : {};
    const { error } = await supabase.from("profiles").update({ settings: { ...current, ...next } }).eq("id", userId);
    if (error) toast.error("Impossible de marquer comme lu", { description: error.message });
  }

  async function markRead(ids: string[]) {
    if (!userId || ids.length === 0) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (ids.includes(n.id) && !n.read_at ? { ...n, read_at: now } : n)));
    const nextIds = [...new Set([...prefsRef.current.read_ids, ...ids, ...ids.map((id) => {
      const match = items.find((n) => n.id === id);
      return match ? notifKey(match) : id;
    })])];
    await persistReadIds(nextIds);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-brand text-brand-foreground text-[10px] font-bold flex items-center justify-center shadow-[0_0_8px_var(--brand)]">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 && (
            <Button variant="ghost" size="sm" onClick={() => void markRead(items.filter((n) => !n.read_at).map((n) => n.id))} className="h-7 gap-1 text-xs">
              <CheckCheck className="h-3.5 w-3.5" /> Tout lire
            </Button>
          )}
        </div>
        <div className="max-h-[420px] overflow-y-auto scrollbar-none">
          {items.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Aucune notification</div>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  if (!n.read_at) void markRead([n.id]);
                }}
                className={cn(
                  "w-full text-left px-4 py-3 border-b border-border/60 last:border-0",
                  !n.read_at && "bg-brand/5",
                )}
              >
                <div className="flex items-start gap-2">
                  {!n.read_at && <span className="mt-1.5 h-2 w-2 rounded-full bg-brand shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{n.title}</p>
                    {n.body && <p className="text-xs text-muted-foreground mt-0.5">{n.body}</p>}
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: fr })}
                    </p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
