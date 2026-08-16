import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { ensureAdminSeeded } from "@/lib/admin-seed.functions";
import { signUpAccount } from "@/lib/signup.functions";
import { HexaroLogo } from "@/components/hexaro-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Mail, Lock, Eye, EyeOff, User } from "lucide-react";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Connexion — Hexaro" },
      { name: "description", content: "Accédez à votre espace de gestion Hexaro." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const seed = useServerFn(ensureAdminSeeded);
  const register = useServerFn(signUpAccount);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  useEffect(() => {
    seed().catch(() => {});
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
  }, [seed, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        await register({
          data: { email: email.trim(), password, full_name: fullName.trim() },
        });
      }
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        const banned = /banned|disabled|blocked/i.test(error.message);
        toast.error(banned ? "Accès bloqué" : mode === "signup" ? "Compte créé, connexion refusée" : "Connexion refusée", {
          description: banned
            ? "Un administrateur a bloqué ce compte. Contactez-le pour rétablir l’accès."
            : error.message,
        });
        return;
      }
      toast.success(mode === "signup" ? "Espace créé — bienvenue sur Hexaro" : "Bienvenue sur Hexaro");
      navigate({ to: "/dashboard", replace: true });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Inscription impossible");
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setGoogleBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth`,
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      toast.error("Google indisponible", { description: error.message });
      setGoogleBusy(false);
    }
  }

  async function handleReset() {
    if (!email.trim()) return toast.error("Saisissez votre email d'abord");
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth`,
    });
    if (error) toast.error(error.message);
    else toast.success("Email de réinitialisation envoyé");
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
            <h2 className="text-2xl font-bold">
              {mode === "signup" ? "Créer votre espace" : "Connexion à votre espace"}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {mode === "signup"
                ? "Inscription gratuite. Vos données restent isolées dans votre compte."
                : "Email, mot de passe ou Google — même compte à chaque fois."}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
            {mode === "signup" && (
              <div className="space-y-2">
                <Label htmlFor="fullName">Nom</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input id="fullName" required minLength={2} value={fullName} onChange={(e) => setFullName(e.target.value)} className="pl-9 h-11" placeholder="Votre nom" />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input id="email" type="email" autoComplete="off" required value={email} onChange={(e) => setEmail(e.target.value)} className="pl-9 h-11" placeholder="vous@email.com" />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label htmlFor="password">Mot de passe</Label>
                {mode === "login" && (
                  <button type="button" onClick={handleReset} className="text-xs text-brand hover:underline">Mot de passe oublié ?</button>
                )}
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input id="password" type={showPwd ? "text" : "password"} autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="pl-9 pr-10 h-11" placeholder="••••••••" />
                <button type="button" onClick={() => setShowPwd((v) => !v)} aria-label={showPwd ? "Masquer" : "Afficher"} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button type="submit" disabled={busy} className="w-full h-11 bg-brand text-brand-foreground hover:opacity-90 hex-glow font-semibold">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "signup" ? "Créer mon espace" : "Se connecter"}
            </Button>
          </form>

          <p className="text-sm text-center text-muted-foreground">
            {mode === "signup" ? "Déjà un compte ?" : "Pas encore de compte ?"}{" "}
            <button
              type="button"
              className="text-brand font-medium hover:underline"
              onClick={() => setMode(mode === "signup" ? "login" : "signup")}
            >
              {mode === "signup" ? "Se connecter" : "Inscription"}
            </button>
          </p>

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
        </div>
      </div>
    </div>
  );
}
