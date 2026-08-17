import { supabase } from "@/integrations/supabase/client";

export async function sessionNeedsMfa() {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return false;
  return data.nextLevel === "aal2" && data.currentLevel !== "aal2";
}

export async function listTotpFactor() {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return null;
  return data.totp.find((f) => f.status === "verified") ?? data.totp[0] ?? null;
}

export async function verifyTotpCode(code: string) {
  const factor = await listTotpFactor();
  if (!factor) throw new Error("Aucun code d’authentification n’est configuré.");
  const { data: challenge, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId: factor.id });
  if (challengeErr || !challenge) throw new Error("Impossible de vérifier le code.");
  const { error } = await supabase.auth.mfa.verify({
    factorId: factor.id,
    challengeId: challenge.id,
    code: code.replace(/\s/g, ""),
  });
  if (error) throw new Error("Code incorrect.");
}
