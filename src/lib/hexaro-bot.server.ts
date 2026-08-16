import { computeExpiration, formatMoney } from "@/lib/hexaro";

const METHOD: Record<string, string> = {
  especes: "Espèces",
  airtel_money: "Airtel Money",
  moov_money: "Moov Money",
  virement: "Virement",
  autre: "Autre",
};

const KIND: Record<string, string> = {
  nouveau: "Nouveau",
  renouvellement: "Renouvellement",
};

const SVC: Record<string, string> = {
  netflix: "Netflix",
  spotify: "Spotify",
  internet: "Internet Libertis",
};

type ChatMsg = { role: "user" | "assistant"; content: string };

const MODELS = ["google/gemini-2.5-flash", "openai/gpt-4o-mini"] as const;
const TZ = "Africa/Libreville";

function formatLongDate(d: Date) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

function formatClock(d: Date) {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(d);
}

function formatPayWhen(iso: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: TZ,
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function serviceLabel(slug: string, catalog?: Map<string, string>) {
  return catalog?.get(slug) || SVC[slug] || slug;
}

function kindLabel(kind: string) {
  return KIND[kind] || kind || "—";
}

function payLine(p: any, catalog?: Map<string, string>) {
  return `${formatPayWhen(p.paid_at)} | ${p.client_name || "—"} | ${serviceLabel(p.service_slug, catalog)} | ${formatMoney(p.amount)} | ${METHOD[p.method] || p.method} | ${kindLabel(p.kind)}`;
}

function subTiming(start: string | null | undefined, days: number | null | undefined) {
  const exp = computeExpiration(start, days);
  return {
    endsOn: formatLongDate(exp.expiresAt),
    remaining: exp.status === "expired" ? "déjà terminé" : `dans ${exp.days} jour${exp.days > 1 ? "s" : ""}`,
    ms: exp.msRemaining,
    status: exp.status,
  };
}

export async function warmSnapshot(supabase: any, userId: string) {
  await buildSnapshot(supabase, userId);
}

export async function runHexaroBot(
  supabase: any,
  userId: string,
  messages: ChatMsg[],
  identity?: { email?: string; name?: string },
) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY manquante dans .env");

  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content?.trim();
  if (!lastUser) throw new Error("Message vide");

  const snapshot = await buildSnapshot(supabase, userId, identity);
  const history = messages.slice(-8).map((m) => ({
    role: m.role,
    content: m.content.slice(0, 2000),
  }));

  let lastErr = "OpenRouter indisponible";
  for (const model of MODELS) {
    try {
      const text = await complete(key, model, snapshot, history);
      if (text) return { reply: text };
    } catch (e: any) {
      lastErr = e?.message || lastErr;
    }
  }
  throw new Error(lastErr);
}

async function complete(key: string, model: string, snapshot: string, history: ChatMsg[]) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://hexaro.app",
      "X-Title": "Hexaro",
    },
    body: JSON.stringify({
      model,
      temperature: 0.15,
      max_tokens: 420,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "system", content: snapshot },
        ...history,
      ],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || res.statusText || "OpenRouter indisponible");
  const text = body?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Réponse vide du modèle");
  return text;
}

const SYSTEM_PROMPT = `Tu es le comptable d'Hexaro. Tu parles comme un humain : naturel, clair, précis.

Règles de ton :
- Interdit : les mots snapshot, capture, section, « détail du calcul », et toute ligne brute du type « Internet Libertis | Fridolin | 3 500 F | 29j… ».
- Interdit de recoller les données internes. Tu les reformules en phrases.
- Pour une date de fin : donne la date calendrier (ex. « ça se termine le dimanche 14 septembre 2026 »). Tu peux ajouter « dans 29 jours » ensuite, jamais l'inverse seul.
- Aujourd'hui est indiqué dans les données. Utilise la date de fin déjà calculée (champ « fin le »).
- Argent : résultat en F, une courte phrase. Pas de dump technique.
- Tu calcules tout (moyennes, totaux, projections) sans jamais dire que tu ne peux pas.
- Tu connais l'utilisateur connecté : nom, identifiant, email, rôle. Réponds-lui par son nom si on te le demande.
- Jamais de mot de passe ni PIN. N'invente aucun client ni montant.
- « dernier paiement / dernier virement / dernier encaissement » = le bloc DERNIER ENCAISSEMENT, toutes méthodes (espèces, Airtel, Moov, virement). Ne filtre par méthode que si l'utilisateur la nomme clairement (ex. « en espèces », « Airtel »).
- Le nom du client n'est pas un type de paiement : « Reajustement » peut être un client, pas un virement.
- Pour un encaissement : cite toujours date + heure, client, service, montant et méthode.`;

async function buildSnapshot(supabase: any, userId: string, identity?: { email?: string; name?: string }) {
  const [nfp, spm, isub, ssub, pay, services, me, roles] = await Promise.all([
    supabase.from("netflix_profiles").select("profile_name, pseudo, start_date, duration_days, price, status"),
    supabase.from("spotify_members").select("member_name, pseudo, start_date, duration_days, price, status"),
    supabase.from("internet_subscriptions").select("client_name, phone, sim_number, start_date, duration_days, price, status"),
    supabase.from("service_subscriptions").select("client_name, phone, account_email, start_date, duration_days, price, status, service_id"),
    supabase.from("payments").select("amount, paid_at, client_name, service_slug, method, kind, voided_at").order("paid_at", { ascending: false }).limit(400),
    supabase.from("services").select("id, name, slug"),
    supabase.from("profiles").select("full_name, phone").eq("id", userId).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId),
  ]);
  const authUser = (await supabase.auth.getUser())?.data?.user;
  const fullName = me.data?.full_name?.trim() || identity?.name || authUser?.user_metadata?.full_name || "";
  const email = identity?.email || authUser?.email || "";
  const login = email.split("@")[0] || "";
  const roleList = (roles.data ?? []).map((r: { role: string }) => r.role).join(", ") || "utilisateur";
  const who = `UTILISATEUR CONNECTÉ : ${fullName || login || "non renseigné"} | identifiant ${login || "—"} | ${email || "—"} | rôle ${roleList}`;

  const svcById = new Map((services.data ?? []).map((s: any) => [s.id, s]));
  const svcBySlug = new Map((services.data ?? []).map((s: any) => [s.slug, s.name]));
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const payments = ((pay.data ?? []) as any[])
    .filter((p) => !p.voided_at)
    .sort((a, b) => +new Date(b.paid_at) - +new Date(a.paid_at));
  const sum = (arr: any[]) => arr.reduce((a, p) => a + Number(p.amount ?? 0), 0);
  const solde = sum(payments);
  const thisMonthPays = payments.filter((p) => new Date(p.paid_at) >= monthStart);
  const prevMonthPays = payments.filter((p) => {
    const d = new Date(p.paid_at);
    return d >= prevMonthStart && d < monthStart;
  });
  const thisMonth = sum(thisMonthPays);
  const prevMonth = sum(prevMonthPays);

  const byService: Record<string, { total: number; n: number }> = {};
  const byClient: Record<string, number> = {};
  const byMonth: Record<string, number> = {};
  for (const p of payments) {
    const slug = p.service_slug || "autre";
    const client = (p.client_name || "—").trim() || "—";
    const d = new Date(p.paid_at);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    byService[slug] = byService[slug] ?? { total: 0, n: 0 };
    byService[slug].total += Number(p.amount ?? 0);
    byService[slug].n += 1;
    byClient[client] = (byClient[client] ?? 0) + Number(p.amount ?? 0);
    byMonth[ym] = (byMonth[ym] ?? 0) + Number(p.amount ?? 0);
  }

  const amounts = payments.map((p) => Number(p.amount ?? 0)).sort((a, b) => a - b);
  const median = amounts.length
    ? amounts.length % 2
      ? amounts[(amounts.length - 1) / 2]!
      : Math.round((amounts[amounts.length / 2 - 1]! + amounts[amounts.length / 2]!) / 2)
    : 0;
  const nPay = payments.length;
  const nClients = Object.keys(byClient).length;
  const nMonths = Object.keys(byMonth).length || 1;
  const avgPay = nPay ? Math.round(solde / nPay) : 0;
  const avgClient = nClients ? Math.round(solde / nClients) : 0;
  const avgMonth = Math.round(solde / nMonths);
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dailyPace = dayOfMonth ? Math.round(thisMonth / dayOfMonth) : 0;
  const monthProjection = dailyPace * daysInMonth;
  const monthDeltaPct = prevMonth ? Math.round(((thisMonth - prevMonth) / prevMonth) * 100) : null;

  type Row = { service: string; name: string; extra: string; price: number; remaining: string; endsOn: string; ms: number; status: string };
  const rows: Row[] = [];

  function pushRow(service: string, name: string, extra: string, price: number, start: string, days: number, status?: string) {
    const t = subTiming(start, days);
    rows.push({
      service,
      name,
      extra,
      price,
      remaining: t.remaining,
      endsOn: t.endsOn,
      ms: t.ms,
      status: status === "suspended" ? "inactif" : t.status,
    });
  }

  for (const p of nfp.data ?? []) {
    pushRow("Netflix", p.profile_name, p.pseudo || "", Number(p.price ?? 0), p.start_date, p.duration_days, p.status);
  }
  for (const p of spm.data ?? []) {
    pushRow("Spotify", p.member_name, p.pseudo || "", Number(p.price ?? 0), p.start_date, p.duration_days, p.status);
  }
  for (const p of isub.data ?? []) {
    pushRow("Internet Libertis", p.client_name, [p.phone, p.sim_number].filter(Boolean).join(" / "), Number(p.price ?? 0), p.start_date, p.duration_days, p.status);
  }
  if (!ssub.error) {
    for (const p of ssub.data ?? []) {
      const svc = svcById.get(p.service_id);
      pushRow(svc?.name || "Service", p.client_name, p.phone || p.account_email || "", Number(p.price ?? 0), p.start_date, p.duration_days, p.status);
    }
  }

  rows.sort((a, b) => a.ms - b.ms);
  const active = rows.filter((r) => r.status !== "expired" && r.status !== "inactif");
  const expired = rows.filter((r) => r.status === "expired");
  const urgences = rows.filter((r) => r.status === "expired" || r.status === "soon").slice(0, 20);

  const avgAbo = rows.length ? Math.round(rows.reduce((a, r) => a + r.price, 0) / rows.length) : 0;
  const avgAboActif = active.length ? Math.round(active.reduce((a, r) => a + r.price, 0) / active.length) : 0;
  const topClients = Object.entries(byClient)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, n]) => `- ${name}: ${formatMoney(n)}`)
    .join("\n");
  const monthLines = Object.entries(byMonth)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ym, n]) => `- ${ym}: ${formatMoney(n)}`)
    .join("\n");

  const lastPay = payments[0];
  const hist = payments.slice(0, 40).map((p) => payLine(p, svcBySlug));

  const abos = rows.slice(0, 120).map((r) =>
    `${r.name} — ${r.service}${r.extra ? ` (${r.extra})` : ""} — ${formatMoney(r.price)} — ${r.status} — fin le ${r.endsOn} (${r.remaining})`,
  );

  const serviceLines = Object.entries(byService)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([slug, v]) => `- ${serviceLabel(slug, svcBySlug)}: total ${formatMoney(v.total)} | ${v.n} encaissement(s) | moyenne ${formatMoney(v.n ? Math.round(v.total / v.n) : 0)}`)
    .join("\n");

  return `${who}

AUJOURD'HUI : ${formatLongDate(now)}, ${formatClock(now)}
DERNIER ENCAISSEMENT (toutes méthodes, le plus récent — réponse obligatoire si on demande le dernier paiement/virement/encaissement)
${lastPay ? payLine(lastPay, svcBySlug) : "- aucun"}
CHIFFRES
- Solde: ${formatMoney(solde)}
- Ce mois: ${formatMoney(thisMonth)} (${thisMonthPays.length} encaissements)
- Mois précédent: ${formatMoney(prevMonth)} (${prevMonthPays.length} encaissements)${monthDeltaPct === null ? "" : ` | écart ${monthDeltaPct}%`}
- Abonnements: ${rows.length} total, ${active.length} actifs, ${expired.length} expirés

COMPTA
- Encaissements: ${nPay}
- Clients distincts: ${nClients}
- Mois avec activité: ${nMonths}
- Moyenne par encaissement: ${formatMoney(avgPay)} (médiane ${formatMoney(median)})
- Moyenne par client: ${formatMoney(avgClient)}
- Moyenne mensuelle: ${formatMoney(avgMonth)}
- Prix moyen d'un abo: ${formatMoney(avgAbo)} | actifs ${formatMoney(avgAboActif)}
- Rythme ce mois: ${formatMoney(dailyPace)} / jour → projection fin de mois ${formatMoney(monthProjection)}

PAR SERVICE
${serviceLines || "- aucun"}
PAR MOIS
${monthLines || "- aucun"}
TOP CLIENTS
${topClients || "- aucun"}
URGENCES
${urgences.length ? urgences.map((r) => `- ${r.name} (${r.service}) : fin le ${r.endsOn} (${r.remaining}) · ${formatMoney(r.price)}`).join("\n") : "- aucune"}
ABONNEMENTS
${abos.join("\n") || "- aucun"}
HISTORIQUE
${hist.join("\n") || "- aucun"}`;
}
