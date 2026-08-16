import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const MIG_DIR = path.join(ROOT, "supabase", "migrations");

function isNewKey(value) {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function authHeaders(service) {
  const headers = {
    apikey: service,
    "Content-Type": "application/json",
  };
  if (!isNewKey(service)) headers.Authorization = `Bearer ${service}`;
  return headers;
}

async function restTableExists(url, service, table) {
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${table}?select=id&limit=1`, {
    headers: { ...authHeaders(service), Prefer: "count=exact" },
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text: text.slice(0, 240) };
}

async function runQuery(url, service, sql) {
  const ref = new URL(url).hostname.split(".")[0];
  const headers = authHeaders(service);
  const endpoints = [
    { url: `${url.replace(/\/$/, "")}/pg/query`, body: { query: sql } },
    { url: `${url.replace(/\/$/, "")}/pg-meta/default/query`, body: { query: sql } },
    { url: `${url.replace(/\/$/, "")}/pg/query`, body: { query: sql } },
    {
      url: `https://api.supabase.com/v1/projects/${ref}/database/query`,
      headers: { Authorization: `Bearer ${service}`, "Content-Type": "application/json" },
      body: { query: sql },
    },
    {
      url: `https://api.supabase.com/v1/projects/${ref}/database/migrations`,
      headers: { Authorization: `Bearer ${service}`, "Content-Type": "application/json" },
      body: { query: sql, name: "hexaro_schema" },
    },
  ];

  const errors = [];
  for (const endpoint of endpoints) {
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers: endpoint.headers ?? headers,
      body: JSON.stringify(endpoint.body),
    });
    const text = await res.text();
    if (res.ok) return { ok: true, endpoint: endpoint.url, text };
    errors.push(`${endpoint.url} → ${res.status} ${text.slice(0, 160)}`);
  }
  return { ok: false, error: errors.join("\n") };
}

async function main() {
  const url = process.env.TARGET_SUPABASE_URL;
  const service = process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) {
    console.error("TARGET_SUPABASE_URL / TARGET_SUPABASE_SERVICE_ROLE_KEY requis");
    process.exit(1);
  }

  const probe = await restTableExists(url, service, "profiles");
  if (probe.ok) {
    console.log("Schéma déjà présent (table profiles OK).");
    return;
  }
  console.log(`Probe profiles: ${probe.status} ${probe.text}`);

  const files = (await readdir(MIG_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const combined = [];
  for (const file of files) {
    const sql = await readFile(path.join(MIG_DIR, file), "utf8");
    if (!sql.trim()) continue;
    combined.push(`-- ========== ${file} ==========\n${sql.trim()}`);
  }
  const outDir = path.join(ROOT, "exports");
  await mkdir(outDir, { recursive: true });
  const combinedPath = path.join(outDir, "schema-all.sql");
  await writeFile(combinedPath, combined.join("\n\n") + "\n");
  console.log(`SQL combiné → ${combinedPath}`);

  console.log(`Migrations: ${files.length}`);
  for (const file of files) {
    const sql = await readFile(path.join(MIG_DIR, file), "utf8");
    if (!sql.trim()) continue;
    process.stdout.write(`→ ${file}… `);
    const result = await runQuery(url, service, sql);
    if (!result.ok) {
      console.log("ÉCHEC (la service_role ne peut pas exécuter du DDL)");
      console.error(result.error);
      console.error(
        "\nOuvre https://supabase.com/dashboard/project/kiggmajeihmdkzdhjrwb/sql/new\nColle exports/schema-all.sql → Run. Puis relance l’import.",
      );
      process.exit(2);
    }
    console.log("OK");
  }
  console.log("Schéma appliqué.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
