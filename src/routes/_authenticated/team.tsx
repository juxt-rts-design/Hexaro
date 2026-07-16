import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listTeam, createManager, deleteTeamMember } from "@/lib/team.functions";
import { PageHeader, StatusPill, EmptyState } from "@/components/hexaro-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/hexaro";
import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/team")({
  head: () => ({ meta: [{ title: "Équipe — Hexaro" }] }),
  component: TeamPage,
});

function TeamPage() {
  const { isAdmin, loading } = useAuth();
  const qc = useQueryClient();
  const fetchTeam = useServerFn(listTeam);
  const createMgr = useServerFn(createManager);
  const removeMember = useServerFn(deleteTeamMember);
  const [open, setOpen] = useState(false);

  const { data = [], isLoading } = useQuery({
    queryKey: ["team"],
    queryFn: () => fetchTeam(),
    enabled: isAdmin,
  });

  const create = useMutation({
    mutationFn: async (v: any) => createMgr({ data: v }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["team"] }); toast.success("Manager créé"); setOpen(false); },
    onError: (e: any) => toast.error(e.message ?? "Erreur"),
  });

  const del = useMutation({
    mutationFn: async (user_id: string) => removeMember({ data: { user_id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["team"] }); toast.success("Membre supprimé"); },
    onError: (e: any) => toast.error(e.message ?? "Erreur"),
  });

  if (loading) return null;
  if (!isAdmin) return <Navigate to="/dashboard" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Équipe"
        description="Gérez les administrateurs et managers de la plateforme."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button className="bg-brand text-brand-foreground gap-2"><Plus className="h-4 w-4" /> Nouveau manager</Button></DialogTrigger>
            <ManagerForm onSubmit={(v) => create.mutate(v)} submitting={create.isPending} />
          </Dialog>
        }
      />

      {isLoading ? <p className="text-sm text-muted-foreground">Chargement…</p> :
       data.length === 0 ? <EmptyState title="Aucun membre" /> : (
        <div className="hex-glass rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground bg-muted/30">
              <tr>
                <th className="px-5 py-3">Membre</th>
                <th className="px-5 py-3">Rôle</th>
                <th className="px-5 py-3 hidden md:table-cell">Dernière connexion</th>
                <th className="px-5 py-3 hidden lg:table-cell">Créé le</th>
                <th className="px-5 py-3 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {data.map((m: any) => {
                const isAdm = m.roles.includes("admin");
                return (
                  <tr key={m.id} className="border-t border-border">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        {isAdm && <ShieldCheck className="h-4 w-4 text-brand" />}
                        <span className="font-medium">{m.email}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <StatusPill tone={isAdm ? "warning" : "success"}>{isAdm ? "Administrateur" : m.roles[0] ?? "—"}</StatusPill>
                    </td>
                    <td className="px-5 py-3 hidden md:table-cell text-muted-foreground">{m.last_sign_in_at ? formatDateTime(m.last_sign_in_at) : "Jamais"}</td>
                    <td className="px-5 py-3 hidden lg:table-cell text-muted-foreground">{formatDateTime(m.created_at)}</td>
                    <td className="px-5 py-3 text-right">
                      {!isAdm && (
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => { if (confirm("Supprimer ce membre ?")) del.mutate(m.id); }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ManagerForm({ onSubmit, submitting }: any) {
  const [v, setV] = useState({ full_name: "", email: "", password: "" });
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Nouveau manager</DialogTitle></DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(v); }} className="space-y-4">
        <div className="space-y-2"><Label>Nom complet *</Label><Input required value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} /></div>
        <div className="space-y-2"><Label>Email *</Label><Input required type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></div>
        <div className="space-y-2"><Label>Mot de passe temporaire *</Label><Input required minLength={8} value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} /></div>
        <DialogFooter><Button type="submit" disabled={submitting} className="bg-brand text-brand-foreground">{submitting ? "…" : "Créer"}</Button></DialogFooter>
      </form>
    </DialogContent>
  );
}
