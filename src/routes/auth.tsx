import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { ensureAdminSeeded } from "@/lib/admin-seed.functions";
import { gateAuthAttempt } from "@/lib/signup.functions";
import { HexaroLogo } from "@/components/hexaro-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Mail, Lock, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { sessionNeedsMfa, verifyTotpCode } from "@/lib/mfa";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Connexion — Hexaro" },
      { name: "description", content: "Accédez à votre espace de gestion Hexaro." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AuthPage,
});

async function ensureStaffOrSignOut(userId: string) {
  const { data: staff } = await supabase.rpc("is_staff", { _user_id: userId });
  if (staff) return true;
  await supabase.auth.signOut();
  return false;
}

function AuthPage() {
  const navigate = useNavigate();
  const seed = useServerFn(ensureAdminSeeded);
  const gate = useServerFn(gateAuthAttempt);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [needMfa, setNeedMfa] = useState(false);

  async function enterIfAllowed(userId: string) {
    if (!(await ensureStaffOrSignOut(userId))) {
      toast.error("Accès refusé", { description: "Ce compte n’a pas les droits Hexaro." });
      return false;
    }
    if (await sessionNeedsMfa()) {
      setNeedMfa(true);
      return false;
    }
    toast.success("Bienvenue sur Hexaro");
    navigate({ to: "/dashboard", replace: true });
    return true;
  }

  useEffect(() => {
    seed().catch(() => {});
    supabase.auth.getSession().then(async ({ data }) => {
      const uid = data.session?.user?.id;
      if (!uid) return;
      if (!(await ensureStaffOrSignOut(uid))) return;
      if (await sessionNeedsMfa()) {
        setNeedMfa(true);
        return;
      }
      navigate({ to: "/dashboard", replace: true });
    });
  }, [seed, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await gate({ data: { email: email.trim() } });
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        const banned = /banned|disabled|blocked/i.test(error.message);
        toast.error(banned ? "Accès bloqué" : "Connexion refusée", {
          description: banned
            ? "Un administrateur a bloqué ce compte."
            : "Email ou mot de passe incorrect.",
        });
        return;
      }
      const uid = data.user?.id;
      if (!uid) return;
      await enterIfAllowed(uid);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Connexion impossible");
    } finally {
      setBusy(false);
    }
  }

  async function handleMfa(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await verifyTotpCode(mfaCode);
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user?.id;
      if (!uid) throw new Error("Session expirée. Reconnecte-toi.");
      setNeedMfa(false);
      await enterIfAllowed(uid);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Code incorrect");
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setGoogleBusy(true);
    try {
      await gate({ data: email.trim() ? { email: email.trim() } : {} });
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth`,
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) {
        toast.error("Google indisponible");
        setGoogleBusy(false);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Google indisponible");
      setGoogleBusy(false);
    }
  }

  async function handleReset() {
    if (!email.trim()) return toast.error("Saisissez votre email d'abord");
    try {
      await gate({ data: { email: email.trim() } });
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth`,
      });
      if (error) toast.error("Impossible d’envoyer l’email de réinitialisation");
      else toast.success("Email de réinitialisation envoyé");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Impossible d’envoyer l’email");
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="relative hidden lg:flex flex-col justify-between p-12 overflow-hidden border-r border-border">
        <div
          aria-hidden
          className="absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(ellipse 700px 500px at 20% 20%, color-mix(in oklab, var(--brand) 20%, transparent), transparent 60%), radial-gradient(ellipse 600px 500px at 80% 80%, color-mix(in oklab, oklch(0.5 0.18 260) 25%, transparent), transparent 60%)",
          }}
        />
        <HexaroLogo size={40} />
        <div className="space-y-6 max-w-md">
          <h1 className="text-4xl font-bold leading-tight">
            La plateforme <span className="hex-gradient-text">tout-en-un</span> pour votre business d'abonnements.
          </h1>
          <p className="text-muted-foreground leading-relaxed">
            Netflix, Spotify, Internet Libertis et vos futurs services — centralisez la gestion, les
            expirations et vos revenus dans un seul tableau de bord moderne.
          </p>
          <div className="grid grid-cols-3 gap-3">
            {["Netflix", "Spotify", "Internet"].map((s) => (
              <div key={s} className="hex-glass rounded-xl px-3 py-4 text-center">
                <p className="text-2xl font-bold hex-gradient-text">∞</p>
                <p className="text-xs text-muted-foreground mt-1">{s}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} Hexaro</p>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md space-y-8">
          <div className="lg:hidden">
            <HexaroLogo size={36} />
          </div>
          <div>
            <h2 className="text-2xl font-bold">{needMfa ? "Vérification" : "Connexion à votre espace"}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {needMfa
                ? "Saisis le code à 6 chiffres de ton application d’authentification."
                : "Accès réservé à l’équipe. Les comptes sont créés par l’administrateur."}
            </p>
          </div>

          {needMfa ? (
            <form onSubmit={handleMfa} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="mfa">Code d’authentification</Label>
                <div className="relative">
                  <ShieldCheck className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="mfa"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]*"
                    maxLength={8}
                    required
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                    className="pl-9 h-11 tracking-[0.3em]"
                    placeholder="000000"
                  />
                </div>
              </div>
              <Button type="submit" disabled={busy || mfaCode.length < 6} className="w-full h-11 bg-brand text-brand-foreground hover:opacity-90 hex-glow font-semibold">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Valider"}
              </Button>
              <button
                type="button"
                className="w-full text-sm text-muted-foreground hover:text-foreground"
                onClick={async () => {
                  await supabase.auth.signOut();
                  setNeedMfa(false);
                  setMfaCode("");
                }}
              >
                Annuler
              </button>
            </form>
          ) : (
          <>
          <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="pl-9 h-11" placeholder="vous@email.com" />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label htmlFor="password">Mot de passe</Label>
                <button type="button" onClick={handleReset} className="text-xs text-brand hover:underline">Mot de passe oublié ?</button>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input id="password" type={showPwd ? "text" : "password"} autoComplete="current-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="pl-9 pr-10 h-11" placeholder="••••••••" />
                <button type="button" onClick={() => setShowPwd((v) => !v)} aria-label={showPwd ? "Masquer" : "Afficher"} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button type="submit" disabled={busy} className="w-full h-11 bg-brand text-brand-foreground hover:opacity-90 hex-glow font-semibold">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Se connecter"}
            </Button>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
            <div className="relative flex justify-center text-xs uppercase"><span className="bg-background px-3 text-muted-foreground">ou</span></div>
          </div>

          <Button type="button" variant="outline" onClick={handleGoogle} disabled={googleBusy} className="w-full h-11 gap-2">
            {googleBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : (
              <svg width="16" height="16" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
            )}
            Continuer avec Google
          </Button>
          </>
          )}
        </div>
      </div>
    </div>
  );
}
