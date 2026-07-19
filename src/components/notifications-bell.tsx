import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useServerFn } from "@tanstack/react-start";
import { markAllRead } from "@/lib/notifications.functions";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Notif = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  created_at: string;
  read_at: string | null;
  recipient_id: string | null;
};

export function NotificationsBell() {
  const { user, isAdmin } = useAuth();
  const [items, setItems] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);
  const markAll = useServerFn(markAllRead);

  const canSeeBroadcast = isAdmin;

  useEffect(() => {
    if (!user) return;
    let mounted = true;

    const load = async () => {
      const filter = canSeeBroadcast
        ? `recipient_id.eq.${user.id},recipient_id.is.null`
        : `recipient_id.eq.${user.id}`;
      const { data } = await supabase
        .from("notifications")
        .select("id,type,title,body,created_at,read_at,recipient_id")
        .or(filter)
        .order("created_at", { ascending: false })
        .limit(30);
      if (mounted) setItems((data as any) ?? []);
    };
    load();

    const channel = supabase
      .channel("notifications-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        (payload) => {
          const n = payload.new as Notif;
          const forMe = n.recipient_id === user.id || (n.recipient_id === null && canSeeBroadcast);
          if (!forMe) return;
          setItems((prev) => [n, ...prev].slice(0, 30));
          toast(n.title, { description: n.body ?? undefined });
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [user, canSeeBroadcast]);

  const unread = items.filter((i) => !i.read_at).length;

  async function handleMarkAll() {
    await markAll();
    setItems((prev) => prev.map((i) => ({ ...i, read_at: i.read_at ?? new Date().toISOString() })));
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
            <Button variant="ghost" size="sm" onClick={handleMarkAll} className="h-7 gap-1 text-xs">
              <CheckCheck className="h-3 w-3" /> Tout lire
            </Button>
          )}
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {items.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Aucune notification</div>
          ) : (
            items.map((n) => (
              <div
                key={n.id}
                className={cn(
                  "px-4 py-3 border-b border-border/60 last:border-0",
                  !n.read_at && "bg-brand/5"
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
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
