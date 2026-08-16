import { formatMoney, formatDate, formatDateTime, computeExpiration } from "@/lib/hexaro";
import { methodLabel } from "@/lib/payments";

export type FicheSub = {
  service: string;
  serviceLabel: string;
  client: string;
  start_date: string;
  duration_days: number;
  price: number;
  status?: string;
};

export type FichePay = {
  service: string;
  serviceLabel: string;
  client: string;
  amount: number;
  paid_at: string;
  method: string;
  kind: string;
};

function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function endDate(start: string, days: number) {
  const d = new Date(start);
  d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
  return d;
}

function subState(s: FicheSub) {
  const exp = computeExpiration(s.start_date, s.duration_days);
  if (exp.status === "expired") return { key: "expired" as const, label: "Expiré" };
  if (s.status === "suspended") return { key: "inactive" as const, label: "Inactif" };
  return { key: "active" as const, label: "Actif" };
}

type ServiceFiche = {
  key: string;
  label: string;
  subs: FicheSub[];
  payments: FichePay[];
  actifs: number;
  inactifs: number;
  expires: number;
  solde: number;
  nouveaux: number;
  renouvellements: number;
  ticket: number;
  dureeMoy: number;
  prixMoy: number;
};

function buildServiceFiche(key: string, label: string, subs: FicheSub[], payments: FichePay[]): ServiceFiche {
  const states = subs.map(subState);
  const solde = payments.reduce((a, p) => a + p.amount, 0);
  const nouveaux = payments.filter((p) => p.kind !== "renouvellement").reduce((a, p) => a + p.amount, 0);
  const renouvellements = payments.filter((p) => p.kind === "renouvellement").reduce((a, p) => a + p.amount, 0);
  return {
    key,
    label,
    subs,
    payments,
    actifs: states.filter((s) => s.key === "active").length,
    inactifs: states.filter((s) => s.key === "inactive").length,
    expires: states.filter((s) => s.key === "expired").length,
    solde,
    nouveaux,
    renouvellements,
    ticket: payments.length ? solde / payments.length : 0,
    dureeMoy: subs.length ? subs.reduce((a, s) => a + s.duration_days, 0) / subs.length : 0,
    prixMoy: subs.length ? subs.reduce((a, s) => a + s.price, 0) / subs.length : 0,
  };
}

function kpi(lbl: string, val: string) {
  return `<div class="kpi"><div class="lbl">${esc(lbl)}</div><div class="val">${val}</div></div>`;
}

function subsTable(subs: FicheSub[]) {
  if (!subs.length) return `<p class="empty">Aucun abonnement.</p>`;
  return `<table>
    <thead><tr><th>Client</th><th>Début</th><th>Fin</th><th>Durée</th><th>Statut</th><th class="right">Prix</th></tr></thead>
    <tbody>
      ${subs
        .map((s) => {
          const st = subState(s);
          return `<tr>
            <td>${esc(s.client)}</td>
            <td>${esc(formatDate(s.start_date))}</td>
            <td>${esc(formatDate(endDate(s.start_date, s.duration_days).toISOString()))}</td>
            <td>${s.duration_days} j</td>
            <td>${st.label}</td>
            <td class="right">${esc(formatMoney(s.price))}</td>
          </tr>`;
        })
        .join("")}
    </tbody>
  </table>`;
}

function paysTable(payments: FichePay[], solde: number) {
  if (!payments.length) return `<p class="empty">Aucun paiement.</p>`;
  return `<table>
    <thead><tr><th>Date</th><th>Client</th><th>Type</th><th>Méthode</th><th class="right">Montant</th></tr></thead>
    <tbody>
      ${payments
        .map(
          (p) => `<tr>
            <td>${esc(formatDateTime(p.paid_at))}</td>
            <td>${esc(p.client)}</td>
            <td>${p.kind === "renouvellement" ? "Renouvellement" : "Nouveau"}</td>
            <td>${esc(methodLabel(p.method))}</td>
            <td class="right">${esc(formatMoney(p.amount))}</td>
          </tr>`,
        )
        .join("")}
    </tbody>
    <tfoot><tr class="total"><td colspan="4">Solde</td><td class="right">${esc(formatMoney(solde))}</td></tr></tfoot>
  </table>`;
}

export function buildFicheTechniqueHtml(opts: {
  periodLabel: string;
  serviceLabel: string;
  generatedBy: string;
  subs: FicheSub[];
  payments: FichePay[];
}) {
  const global = buildServiceFiche("all", opts.serviceLabel, opts.subs, opts.payments);
  const tauxActif = opts.subs.length ? (global.actifs / opts.subs.length) * 100 : 0;

  const byKey: Map<string, { label: string; subs: FicheSub[]; payments: FichePay[] }> = new Map();
  for (const s of opts.subs) {
    const cur = byKey.get(s.service) ?? { label: s.serviceLabel, subs: [], payments: [] };
    cur.subs.push(s);
    byKey.set(s.service, cur);
  }
  for (const p of opts.payments) {
    const cur = byKey.get(p.service) ?? { label: p.serviceLabel, subs: [], payments: [] };
    cur.payments.push(p);
    byKey.set(p.service, cur);
  }
  const fiches = [...byKey.entries()]
    .map(([key, v]) => buildServiceFiche(key, v.label, v.subs, v.payments))
    .sort((a, b) => a.label.localeCompare(b.label, "fr"));

  const now = formatDateTime(new Date().toISOString());

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>Fiche technique — Hexaro</title>
  <style>
    :root { --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --brand:#16a34a; --soft:#f0fdf4; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Segoe UI", system-ui, sans-serif; color: var(--ink); background: #f8fafc; }
    .page { max-width: 920px; margin: 24px auto; background: #fff; padding: 40px 44px; box-shadow: 0 10px 40px rgb(15 23 42 / 8%); }
    header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid var(--brand); padding-bottom: 18px; margin-bottom: 28px; }
    .brand { font-size: 28px; font-weight: 800; letter-spacing: -0.04em; }
    .brand span { color: var(--brand); }
    .meta { text-align: right; font-size: 12px; color: var(--muted); line-height: 1.6; }
    h1 { font-size: 20px; margin: 0 0 6px; }
    h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--brand); margin: 32px 0 12px; }
    h3 { font-size: 16px; margin: 0 0 12px; }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .kpi { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; background: var(--soft); }
    .kpi .lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
    .kpi .val { font-size: 18px; font-weight: 800; margin-top: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); border-bottom: 1px solid var(--line); padding: 8px 6px; }
    td { padding: 8px 6px; border-bottom: 1px solid #f1f5f9; }
    .right { text-align: right; }
    .total td { font-weight: 800; border-top: 2px solid var(--ink); border-bottom: none; }
    .fiche { border: 1px solid var(--line); border-radius: 14px; padding: 18px 18px 8px; margin-bottom: 16px; page-break-inside: avoid; }
    .fiche h3 { display: flex; justify-content: space-between; align-items: baseline; }
    .fiche h3 span { font-size: 12px; font-weight: 600; color: var(--muted); }
    .empty { font-size: 13px; color: var(--muted); }
    footer { margin-top: 36px; padding-top: 14px; border-top: 1px solid var(--line); font-size: 11px; color: var(--muted); display: flex; justify-content: space-between; }
    @media print {
      body { background: #fff; }
      .page { margin: 0; box-shadow: none; padding: 10mm; max-width: none; }
    }
  </style>
</head>
<body>
  <div class="page">
    <header>
      <div>
        <div class="brand">Hex<span>aro</span></div>
        <h1>Fiche technique d'exploitation</h1>
      </div>
      <div class="meta">
        Générée le ${esc(now)}<br/>
        Période : ${esc(opts.periodLabel)}<br/>
        Service : ${esc(opts.serviceLabel)}<br/>
        Par : ${esc(opts.generatedBy)}
      </div>
    </header>

    <h2>1. Synthèse</h2>
    <div class="kpis">
      ${kpi("Solde", esc(formatMoney(global.solde)))}
      ${kpi("Abonnements actifs", String(global.actifs))}
      ${kpi("Total abonnements", String(opts.subs.length))}
      ${kpi("Inactifs", String(global.inactifs))}
    </div>

    <h2>2. Calculs</h2>
    <table>
      <thead><tr><th>Indicateur</th><th class="right">Valeur</th></tr></thead>
      <tbody>
        <tr><td>Solde (somme des paiements)</td><td class="right">${esc(formatMoney(global.solde))}</td></tr>
        <tr><td>Nombre de paiements</td><td class="right">${opts.payments.length}</td></tr>
        <tr><td>Ticket moyen</td><td class="right">${esc(formatMoney(global.ticket))}</td></tr>
        <tr><td>Nouveaux abonnements (montant)</td><td class="right">${esc(formatMoney(global.nouveaux))}</td></tr>
        <tr><td>Renouvellements (montant)</td><td class="right">${esc(formatMoney(global.renouvellements))}</td></tr>
        <tr><td>Durée moyenne</td><td class="right">${global.dureeMoy.toFixed(0)} j</td></tr>
        <tr><td>Prix moyen des abonnements</td><td class="right">${esc(formatMoney(global.prixMoy))}</td></tr>
        <tr><td>Taux d'actifs</td><td class="right">${tauxActif.toFixed(0)} %</td></tr>
        <tr><td>Arrivés à terme</td><td class="right">${global.expires}</td></tr>
      </tbody>
    </table>

    <h2>3. Récapitulatif par service</h2>
    <table>
      <thead><tr><th>Service</th><th class="right">Abonnements</th><th class="right">Actifs</th><th class="right">Paiements</th><th class="right">Solde</th></tr></thead>
      <tbody>
        ${
          fiches
            .map(
              (r) =>
                `<tr><td>${esc(r.label)}</td><td class="right">${r.subs.length}</td><td class="right">${r.actifs}</td><td class="right">${r.payments.length}</td><td class="right">${esc(formatMoney(r.solde))}</td></tr>`,
            )
            .join("") || `<tr><td colspan="5">Aucune donnée.</td></tr>`
        }
      </tbody>
      <tfoot><tr class="total"><td>Total</td><td class="right">${opts.subs.length}</td><td class="right">${global.actifs}</td><td class="right">${opts.payments.length}</td><td class="right">${esc(formatMoney(global.solde))}</td></tr></tfoot>
    </table>

    <h2>4. Fiches par service</h2>
    ${
      fiches
        .map(
          (f) => `<article class="fiche">
            <h3>${esc(f.label)} <span>${f.subs.length} abo · ${f.payments.length} paiement${f.payments.length > 1 ? "s" : ""}</span></h3>
            <div class="kpis" style="margin-bottom:14px">
              ${kpi("Solde", esc(formatMoney(f.solde)))}
              ${kpi("Actifs", String(f.actifs))}
              ${kpi("Ticket moyen", esc(formatMoney(f.ticket)))}
              ${kpi("Durée moy.", `${f.dureeMoy.toFixed(0)} j`)}
            </div>
            <p style="font-size:12px;color:var(--muted);margin:0 0 10px">Nouveaux ${esc(formatMoney(f.nouveaux))} · Renouvellements ${esc(formatMoney(f.renouvellements))} · Prix moyen ${esc(formatMoney(f.prixMoy))}</p>
            ${subsTable(f.subs)}
          </article>`,
        )
        .join("") || `<p class="empty">Aucun service sur cette sélection.</p>`
    }

    <h2>5. Journal des paiements</h2>
    ${paysTable(opts.payments, global.solde)}

    <footer>
      <span>Hexaro — document interne</span>
      <span>Montants en francs CFA (F)</span>
    </footer>
  </div>
</body>
</html>`;

  return html;
}
