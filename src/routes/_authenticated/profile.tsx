import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { updateOwnProfile, updateOwnPassword } from "@/lib/notifications.functions";
import { PageHeader } from "@/components/hexaro-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { initials } from "@/lib/hexaro";
import { Loader2, Eye, EyeOff, User, Bell, Shield } from "lucide-react";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({ meta: [{ title: "Mon profil — Hexaro" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user, roles } = useAuth();
  const updProfile = useServerFn(updateOwnProfile);
  const updPassword = useServerFn(updateOwnPassword);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);

  const [pwd, setPwd] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [pwdBusy, setPwdBusy] = useState(false);

  const [notifSignIns, setNotifSignIns] = useState(true);
  const [notifCreations, setNotifCreations] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("full_name, phone, bio, settings")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setFullName(data.full_name ?? "");
        setPhone(data.phone ?? "");
        setBio((data as any).bio ?? "");
        const s = (data as any).settings ?? {};
        if (typeof s.notif_signins === "boolean") setNotifSignIns(s.notif_signins);
        if (typeof s.notif_creations === "boolean") setNotifCreations(s.notif_creations);
      });
  }, [user]);

  async function saveProfile() {
    setSaving(true);
    try {
      await updProfile({ data: { full_name: fullName, phone: phone || null, bio: bio || null } });
      toast.success("Profil mis à jour");
    } catch (e: any) {
      toast.error(e.message ?? "Erreur");
    } finally {
      setSaving(false);
    }
  }

  async function savePassword() {
    if (pwd.length < 8) return toast.error("8 caractères minimum");
    setPwdBusy(true);
    try {
      await updPassword({ data: { password: pwd } });
      toast.success("Mot de passe mis à jour");
      setPwd("");
    } catch (e: any) {
      toast.error(e.message ?? "Erreur");
    } finally {
      setPwdBusy(false);
    }
  }

  async function saveSettings(next: { notif_signins?: boolean; notif_creations?: boolean }) {
    const merged = { notif_signins: notifSignIns, notif_creations: notifCreations, ...next };
    setNotifSignIns(merged.notif_signins);
    setNotifCreations(merged.notif_creations);
    if (!user) return;
    await supabase.from("profiles").update({ settings: merged } as any).eq("id", user.id);
    toast.success("Préférences enregistrées");
  }

  const displayName = fullName || user?.email || "";
  const roleLabel = roles.includes("admin") ? "Administrateur" : roles.includes("manager") ? "Manager" : "Utilisateur";

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader title="Mon profil" description="Informations personnelles, sécurité et préférences." />

      <Card className="p-6">
        <div className="flex items-center gap-4 mb-6">
          <Avatar className="h-16 w-16 border border-border">
            <AvatarFallback className="bg-brand-soft text-brand-foreground text-lg font-bold">
              {initials(displayName)}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-semibold text-lg">{displayName}</p>
            <p className="text-sm text-muted-foreground">{user?.email}</p>
            <span className="inline-flex mt-1 text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded bg-brand/15 text-brand">
              {roleLabel}
            </span>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="fn"><User className="inline h-3 w-3 mr-1" />Nom complet</Label>
            <Input id="fn" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ph">Téléphone</Label>
            <Input id="ph" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+241…" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="bio">Bio</Label>
            <Textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} rows={3} />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={saveProfile} disabled={saving} className="bg-brand text-brand-foreground">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enregistrer"}
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="font-semibold mb-4 flex items-center gap-2"><Shield className="h-4 w-4 text-brand" /> Sécurité</h3>
        <div className="space-y-2 max-w-md">
          <Label htmlFor="pwd">Nouveau mot de passe</Label>
          <div className="relative">
            <Input id="pwd" type={showPwd ? "text" : "password"} value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="8 caractères minimum" />
            <button type="button" onClick={() => setShowPwd(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <Button onClick={savePassword} disabled={pwdBusy || pwd.length < 8} className="mt-2">
            {pwdBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Mettre à jour"}
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="font-semibold mb-4 flex items-center gap-2"><Bell className="h-4 w-4 text-brand" /> Préférences de notification</h3>
        <div className="space-y-4">
          <label className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Nouvelles connexions</p>
              <p className="text-xs text-muted-foreground">Toast en direct quand un membre se connecte.</p>
            </div>
            <Switch checked={notifSignIns} onCheckedChange={(v) => saveSettings({ notif_signins: v })} />
          </label>
          <label className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Créations d'utilisateurs</p>
              <p className="text-xs text-muted-foreground">Alerte lorsqu'un nouveau compte est créé.</p>
            </div>
            <Switch checked={notifCreations} onCheckedChange={(v) => saveSettings({ notif_creations: v })} />
          </label>
        </div>
      </Card>
    </div>
  );
}
