import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, StatusPill, EmptyState } from "@/components/hexaro-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Plus, Search, Pencil, Trash2, Phone, MessageCircle, Mail } from "lucide-react";
import { toast } from "sonner";
import { initials, formatDate } from "@/lib/hexaro";
import { useAuth } from "@/hooks/useAuth";
import { z } from "zod";

const clientSchema = z.object({
  first_name: z.string().trim().min(1, "Prénom requis").max(80),
  last_name: z.string().trim().max(80).optional().nullable(),
  pseudo: z.string().trim().max(80).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  whatsapp: z.string().trim().max(30).optional().nullable(),
  email: z.string().trim().email("Email invalide").max(160).optional().or(z.literal("")),
  notes: z.string().max(2000).optional().nullable(),
});

export const Route = createFileRoute("/_authenticated/clients")({
  head: () => ({ meta: [{ title: "Clients — Hexaro" }] }),
  component: ClientsPage,
});

function ClientsPage() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<any | null>(null);
  const [open, setOpen] = useState(false);

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const upsert = useMutation({
    mutationFn: async (payload: any) => {
      const parsed = clientSchema.parse(payload);
      const values = { ...parsed, email: parsed.email || null };
      if (editing?.id) {
        const { error } = await supabase.from("clients").update(values).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("clients").insert(values);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(editing ? "Client mis à jour" : "Client créé");
      setOpen(false);
      setEditing(null);
    },
    onError: (e: any) => toast.error(e.message ?? "Erreur"),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("clients").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      toast.success("Client supprimé");
    },
    onError: (e: any) => toast.error(e.message ?? "Erreur"),
  });

  const filtered = clients.filter((c) => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return [c.first_name, c.last_name, c.pseudo, c.phone, c.whatsapp, c.email]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q));
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        description={`${clients.length} client${clients.length > 1 ? "s" : ""} enregistré${clients.length > 1 ? "s" : ""}`}
        actions={
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
            <DialogTrigger asChild>
              <Button className="bg-brand text-brand-foreground hover:opacity-90 hex-glow gap-2">
                <Plus className="h-4 w-4" /> Nouveau client
              </Button>
            </DialogTrigger>
            <ClientForm
              initial={editing}
              onSubmit={(v) => upsert.mutate(v)}
              submitting={upsert.isPending}
            />
          </Dialog>
        }
      />

      <div className="hex-glass rounded-2xl p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher par nom, pseudo, téléphone…" className="pl-9" />
        </div>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground text-sm">Chargement…</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Aucun client"
          description={search ? "Aucun résultat pour cette recherche." : "Commencez par créer votre premier client."}
          action={!search && <Button onClick={() => setOpen(true)} className="bg-brand text-brand-foreground gap-2"><Plus className="h-4 w-4" /> Créer un client</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((c) => (
            <div key={c.id} className="hex-glass rounded-2xl p-5 hover:border-brand/40 transition group">
              <div className="flex items-start gap-4">
                <Avatar className="h-12 w-12 border border-border">
                  <AvatarFallback className="bg-brand-soft text-brand-foreground font-semibold">{initials(`${c.first_name} ${c.last_name ?? ""}`)}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold truncate">{c.first_name} {c.last_name ?? ""}</h3>
                  {c.pseudo && <p className="text-xs text-muted-foreground">@{c.pseudo}</p>}
                  <div className="mt-2"><StatusPill tone={c.status === "active" ? "success" : c.status === "suspended" ? "warning" : "muted"}>{c.status}</StatusPill></div>
                </div>
              </div>
              <div className="mt-4 space-y-1.5 text-sm">
                {c.phone && <div className="flex items-center gap-2 text-muted-foreground"><Phone className="h-3.5 w-3.5" />{c.phone}</div>}
                {c.whatsapp && <div className="flex items-center gap-2 text-muted-foreground"><MessageCircle className="h-3.5 w-3.5" />{c.whatsapp}</div>}
                {c.email && <div className="flex items-center gap-2 text-muted-foreground truncate"><Mail className="h-3.5 w-3.5" />{c.email}</div>}
              </div>
              <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Créé le {formatDate(c.created_at)}</p>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditing(c); setOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
                  {isAdmin && (
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => { if (confirm("Supprimer ce client ?")) del.mutate(c.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ClientForm({ initial, onSubmit, submitting }: { initial: any | null; onSubmit: (v: any) => void; submitting: boolean }) {
  const [values, setValues] = useState({
    first_name: initial?.first_name ?? "",
    last_name: initial?.last_name ?? "",
    pseudo: initial?.pseudo ?? "",
    phone: initial?.phone ?? "",
    whatsapp: initial?.whatsapp ?? "",
    email: initial?.email ?? "",
    notes: initial?.notes ?? "",
  });
  const set = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{initial ? "Modifier le client" : "Nouveau client"}</DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => { e.preventDefault(); onSubmit(values); }}
        className="grid grid-cols-2 gap-4"
      >
        <div className="space-y-2"><Label>Prénom *</Label><Input required value={values.first_name} onChange={(e) => set("first_name", e.target.value)} /></div>
        <div className="space-y-2"><Label>Nom</Label><Input value={values.last_name} onChange={(e) => set("last_name", e.target.value)} /></div>
        <div className="space-y-2 col-span-2"><Label>Pseudo</Label><Input value={values.pseudo} onChange={(e) => set("pseudo", e.target.value)} /></div>
        <div className="space-y-2"><Label>Téléphone</Label><Input value={values.phone} onChange={(e) => set("phone", e.target.value)} /></div>
        <div className="space-y-2"><Label>WhatsApp</Label><Input value={values.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></div>
        <div className="space-y-2 col-span-2"><Label>Email</Label><Input type="email" value={values.email} onChange={(e) => set("email", e.target.value)} /></div>
        <div className="space-y-2 col-span-2"><Label>Notes</Label><Textarea value={values.notes} onChange={(e) => set("notes", e.target.value)} rows={3} /></div>
        <DialogFooter className="col-span-2">
          <Button type="submit" disabled={submitting} className="bg-brand text-brand-foreground">
            {submitting ? "Enregistrement…" : initial ? "Enregistrer" : "Créer"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
