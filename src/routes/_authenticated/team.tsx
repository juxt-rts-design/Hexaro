import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listTeam, createManager, deleteTeamMember, setManagerAccess, listMemberActivity } from "@/lib/team.functions";
import { PageHeader, StatusPill, EmptyState } from "@/components/hexaro-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, ShieldCheck, Ban, Unlock, History } from "lucide-react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/hexaro";
import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "@tanstack/react-router";
import { useConfirm } from "@/components/confirm-provider";
import { describeActivity } from "@/lib/activity";
import { ProfileAvatar } from "@/lib/netflix-avatars";

export const Route = createFileRoute("/_authenticated/team")({
  head: () => ({ meta: [{ title: "Équipe — Hexaro" }] }),
  component: TeamPage,
});

type TeamMember = {
  id: string;
  email?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
  created_at: string;
  last_sign_in_at?: string | null;
  banned: boolean;
  action_count: number;
  roles: string[];
};

function TeamPage() {
  const { isAdmin, loading } = useAuth();
  const qc = useQueryClient();
  const confirmAction = useConfirm();
  const fetchTeam = useServerFn(listTeam);
  const createMgr = useServerFn(createManager);
  const removeMember = useServerFn(deleteTeamMember);
  const setAccess = useServerFn(setManagerAccess);
  const [open, setOpen] = useState(false);
  const [inspect, setInspect] = useState<TeamMember | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ["team"],
    queryFn: () => fetchTeam(),
    enabled: isAdmin,
  });

  const create = useMutation({
    mutationFn: async (v: { full_name: string; email: string; password: string }) => createMgr({ data: v }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["team"] });
      toast.success(res?.restored ? "Compte existant ajouté à l’équipe" : "Manager créé");
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message || "Création impossible"),
  });

  const del = useMutation({
    mutationFn: async (user_id: string) => removeMember({ data: { user_id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["team"] }); toast.success("Accès retiré"); setInspect(null); },
    onError: (e: Error) => toast.error(e.message ?? "Erreur"),
  });

  const access = useMutation({
    mutationFn: async (v: { user_id: string; blocked: boolean }) => setAccess({ data: v }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["team"] });
      toast.success(v.blocked ? "Accès bloqué — il ne peut plus se connecter" : "Accès rétabli");
    },
    onError: (e: Error) => toast.error(e.message ?? "Erreur"),
  });

  if (loading) return null;
  if (!isAdmin) return <Navigate to="/dashboard" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Équipe"
        description="Les managers gèrent les abonnements. Ils ne peuvent pas supprimer l’historique ni accéder à cette page."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button className="bg-brand text-brand-foreground gap-2"><Plus className="h-4 w-4" /> Nouveau manager</Button></DialogTrigger>
            <ManagerForm onSubmit={(v) => create.mutate(v)} submitting={create.isPending} />
          </Dialog>
        }
      />

      {isLoading ? null :
       data.length === 0 ? <EmptyState title="Aucun membre" /> : (
        <div className="hex-glass rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground bg-muted/30">
              <tr>
                <th className="px-5 py-3">Membre</th>
                <th className="px-5 py-3">Rôle</th>
                <th className="px-5 py-3 hidden md:table-cell">Dernière connexion</th>
                <th className="px-5 py-3 hidden lg:table-cell">Activité</th>
                <th className="px-5 py-3 w-40 text-right">Accès</th>
              </tr>
            </thead>
            <tbody>
              {(data as TeamMember[]).map((m) => {
                const isAdm = m.roles.includes("admin");
                return (
                  <tr key={m.id} className="border-t border-border">
                    <td className="px-5 py-3">
                      <button type="button" className="text-left" onClick={() => setInspect(m)}>
                        <div className="flex items-center gap-2">
                          <ProfileAvatar id={m.avatar_url} name={m.full_name || m.email} className="h-8 w-8 text-xs" />
                          {isAdm && <ShieldCheck className="h-4 w-4 text-brand" />}
                          <span className="font-medium">{m.full_name || m.email}</span>
                        </div>
                        {m.full_name && <p className="text-xs text-muted-foreground pl-10">{m.email}</p>}
                      </button>
                    </td>
                    <td className="px-5 py-3">
                      <StatusPill tone={isAdm ? "warning" : m.banned ? "destructive" : "success"}>
                        {isAdm ? "Administrateur" : m.banned ? "Bloqué" : "Manager"}
                      </StatusPill>
                    </td>
                    <td className="px-5 py-3 hidden md:table-cell text-muted-foreground">{m.last_sign_in_at ? formatDateTime(m.last_sign_in_at) : "Jamais"}</td>
                    <td className="px-5 py-3 hidden lg:table-cell text-muted-foreground">{m.action_count} action{m.action_count > 1 ? "s" : ""}</td>
                    <td className="px-5 py-3 text-right">
                      {!isAdm && (
                        <div className="inline-flex items-center gap-1">
                          <Button size="icon" variant="ghost" className="h-8 w-8" title="Journal du membre" onClick={() => setInspect(m)}>
                            <History className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className={m.banned ? "h-8 w-8 text-success" : "h-8 w-8 text-warning"}
                            title={m.banned ? "Rétablir l’accès" : "Bloquer l’accès"}
                            onClick={async () => {
                              const ok = await confirmAction({
                                title: m.banned ? "Rétablir cet accès ?" : "Bloquer cet accès ?",
                                description: m.banned
                                  ? `${m.email} pourra de nouveau se connecter.`
                                  : `${m.email} sera déconnecté et ne pourra plus entrer sur Hexaro.`,
                                confirmLabel: m.banned ? "Rétablir" : "Bloquer",
                                destructive: !m.banned,
                              });
                              if (ok) access.mutate({ user_id: m.id, blocked: !m.banned });
                            }}
                          >
                            {m.banned ? <Unlock className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" title="Supprimer définitivement" onClick={async () => {
                            if (await confirmAction({ title: "Supprimer cet accès ?", description: `${m.email} sera retiré de la plateforme.`, destructive: true, confirmLabel: "Supprimer" })) del.mutate(m.id);
                          }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!inspect} onOpenChange={(o) => !o && setInspect(null)}>
        {inspect && <MemberActivity member={inspect} />}
      </Dialog>
    </div>
  );
}

function MemberActivity({ member }: { member: TeamMember }) {
  const fetchLogs = useServerFn(listMemberActivity);
  const { data = [], isPending } = useQuery({
    queryKey: ["team_activity", member.id],
    queryFn: () => fetchLogs({ data: { user_id: member.id } }),
  });

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3">
          <ProfileAvatar id={member.avatar_url} name={member.full_name || member.email} className="h-10 w-10 text-sm" />
          <span>{member.full_name || member.email}</span>
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-2 text-sm">
        <p className="text-muted-foreground">{member.email}</p>
        <p>Dernière connexion : <span className="font-medium text-foreground">{member.last_sign_in_at ? formatDateTime(member.last_sign_in_at) : "Jamais"}</span></p>
        <p>Statut : {member.banned ? "Accès bloqué" : member.roles.includes("admin") ? "Administrateur" : "Manager"}</p>
      </div>
      <div className="mt-4 max-h-[50vh] overflow-y-auto scrollbar-none space-y-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Créations et modifications</p>
        {isPending ? null : data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune action enregistrée pour le moment.</p>
        ) : (
          data.map((row) => (
            <div key={row.id} className="rounded-xl border border-border px-3 py-2">
              <p className="text-sm">{describeActivity(row as any)}</p>
              <p className="text-xs text-muted-foreground">{formatDateTime(row.created_at)}</p>
            </div>
          ))
        )}
      </div>
    </DialogContent>
  );
}

function ManagerForm({ onSubmit, submitting }: { onSubmit: (v: { full_name: string; email: string; password: string }) => void; submitting: boolean }) {
  const [v, setV] = useState({ full_name: "", email: "", password: "" });
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Nouveau manager</DialogTitle></DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(v); }} className="space-y-4">
        <div className="space-y-2"><Label>Nom complet *</Label><Input required value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} /></div>
        <div className="space-y-2"><Label>Email *</Label><Input required type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></div>
        <div className="space-y-2"><Label>Mot de passe temporaire *</Label><Input required minLength={8} value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} /></div>
        <p className="text-xs text-muted-foreground">Il pourra créer et modifier des abonnements, mais pas supprimer l’historique des paiements ni gérer l’équipe.</p>
        <DialogFooter><Button type="submit" disabled={submitting} className="bg-brand text-brand-foreground">{submitting ? "…" : "Créer"}</Button></DialogFooter>
      </form>
    </DialogContent>
  );
}
