import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { logActivity } from "@/lib/activity";

export type PaymentMethod = Database["public"]["Enums"]["payment_method"];

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "especes", label: "Espèces" },
  { value: "airtel_money", label: "Airtel Money" },
  { value: "moov_money", label: "Moov Money" },
  { value: "virement", label: "Virement" },
  { value: "autre", label: "Autre" },
];

export function methodLabel(m: string | null | undefined): string {
  return PAYMENT_METHODS.find((x) => x.value === m)?.label ?? "—";
}

export function normalizeClientName(name: string | null | undefined) {
  return (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function localDayBounds(d: Date) {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return { start: start.toISOString(), end: next.toISOString() };
}

export type RecordPaymentInput = {
  service_slug: string;
  amount: number;
  method: PaymentMethod;
  kind: "nouveau" | "renouvellement";
  subscription_id: string;
  subscription_type: string;
  client_name: string;
  reference?: string | null;
  paid_at?: string;
};

/**
 * Source officielle du chiffre d'affaires : chaque encaissement est écrit dans `payments`.
 * L'erreur remonte volontairement pour ne jamais laisser un abonnement sans paiement silencieusement.
 */
export async function recordPayment(input: RecordPaymentInput) {
  const paidAt = input.paid_at ? new Date(input.paid_at) : new Date();
  const name = normalizeClientName(input.client_name);
  if (name) {
    const { start, end } = localDayBounds(paidAt);
    const { data: existing, error: dupErr } = await supabase
      .from("payments")
      .select("id, client_name, paid_at, method")
      .eq("service_slug", input.service_slug)
      .is("voided_at", null)
      .gte("paid_at", start)
      .lt("paid_at", end);
    if (dupErr) throw new Error(`Vérification du paiement impossible : ${dupErr.message}`);
    const dup = (existing ?? []).find((p) => normalizeClientName(p.client_name) === name);
    if (dup) {
      throw new Error(
        `Un paiement pour « ${input.client_name} » existe déjà aujourd'hui sur ce service. Les doublons (même avec un autre moyen de paiement) sont bloqués.`,
      );
    }
  }

  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from("payments").insert({
    service_slug: input.service_slug,
    amount: input.amount,
    method: input.method,
    kind: input.kind,
    subscription_id: input.subscription_id,
    subscription_type: input.subscription_type,
    client_name: input.client_name,
    reference: input.reference ?? null,
    paid_at: paidAt.toISOString(),
    created_by: auth.user?.id ?? null,
  });
  if (error) throw new Error(`Abonnement enregistré, mais le paiement a échoué : ${error.message}`);
}

export async function voidPayment(id: string, reason = "Supprimé depuis l'historique") {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Non connecté");
  const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: uid, _role: "admin" });
  if (!isAdmin) throw new Error("Seul un administrateur peut retirer un paiement de l'historique");
  const { error } = await supabase
    .from("payments")
    .update({ voided_at: new Date().toISOString(), void_reason: reason })
    .eq("id", id);
  if (error) throw new Error(error.message);
  await logActivity({ action: "payments.void", entity_type: "payments", entity_id: id });
}

export type SyncPaymentAmountInput = {
  subscription_id: string;
  subscription_type: string;
  service_slug: string;
  client_name: string;
  amount: number;
  method: PaymentMethod;
  reference?: string | null;
};

/**
 * Quand le montant d'un profil existant change, le dernier paiement non voidé
 * est mis à jour (historique + solde). S'il n'y en a pas encore, on en crée un.
 */
export async function syncLatestPaymentAmount(input: SyncPaymentAmountInput) {
  const amount = Number(input.amount) || 0;
  const { data, error } = await supabase
    .from("payments")
    .select("id, amount")
    .eq("subscription_id", input.subscription_id)
    .is("voided_at", null)
    .order("paid_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`Lecture du paiement impossible : ${error.message}`);

  let last = data?.[0] ?? null;
  if (!last) {
    const name = normalizeClientName(input.client_name);
    if (name) {
      const { data: candidates, error: nameErr } = await supabase
        .from("payments")
        .select("id, amount, client_name")
        .eq("service_slug", input.service_slug)
        .is("voided_at", null)
        .order("paid_at", { ascending: false })
        .limit(80);
      if (nameErr) throw new Error(`Lecture du paiement impossible : ${nameErr.message}`);
      last = (candidates ?? []).find((p) => normalizeClientName(p.client_name) === name) ?? null;
    }
  }

  if (!last) {
    if (amount > 0) {
      await recordPayment({
        service_slug: input.service_slug,
        amount,
        method: input.method,
        kind: "nouveau",
        subscription_id: input.subscription_id,
        subscription_type: input.subscription_type,
        client_name: input.client_name,
        reference: input.reference ?? null,
      });
    }
    return;
  }

  if (Number(last.amount) === amount) return;

  if (amount <= 0) {
    await voidPayment(last.id, "Montant du profil mis à 0");
    return;
  }

  const { error: updErr } = await supabase
    .from("payments")
    .update({
      amount,
      client_name: input.client_name,
      subscription_id: input.subscription_id,
      subscription_type: input.subscription_type,
    })
    .eq("id", last.id);
  if (updErr) {
    throw new Error(`Le profil a été enregistré, mais le solde n'a pas suivi : ${updErr.message}`);
  }
}
