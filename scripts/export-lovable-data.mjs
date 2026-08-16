import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "exports", "lovable-dump");

const TABLES = [
  "services",
  "internet_forfaits",
  "clients",
  "profiles",
  "user_roles",
  "netflix_accounts",
  "netflix_profiles",
  "spotify_accounts",
  "spotify_members",
  "internet_subscriptions",
  "payments",
  "notifications",
  "activity_logs",
];

const ACCOUNT_SELECT = {
  netflix_accounts:
    "id, email, profiles_capacity, created_on, expires_on, status, notes, created_at, updated_at",
  spotify_accounts: "id, email, seats, status, notes, created_at, updated_at",
};

const MEDIA_FOLDERS = ["affiches", "videos", "fiches", "documents"];

async function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const text = await readFile(filePath, "utf8");
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

async function fetchAll(supabase, table, columns = "*") {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function attachAccountPasswords(supabase, service, accounts) {
  const out = [];
  for (const acc of accounts) {
    const { data, error } = await supabase.rpc("get_account_password", {
      _service: service,
      _id: acc.id,
    });
    out.push({ ...acc, password: error ? null : (data ?? null) });
  }
  return out;
}

function harvestUsers(tables) {
  const byId = new Map();
  for (const p of tables.profiles ?? []) {
    byId.set(p.id, { id: p.id, full_name: p.full_name, email: null, roles: [] });
  }
  for (const r of tables.user_roles ?? []) {
    const cur = byId.get(r.user_id) ?? { id: r.user_id, full_name: null, email: null, roles: [] };
    cur.roles.push(r.role);
    byId.set(r.user_id, cur);
  }
  for (const log of tables.activity_logs ?? []) {
    if (log.actor_id && log.actor_email) {
      const cur = byId.get(log.actor_id) ?? {
        id: log.actor_id,
        full_name: null,
        email: null,
        roles: [],
      };
      cur.email = cur.email || log.actor_email;
      byId.set(log.actor_id, cur);
    }
  }
  return [...byId.values()];
}

async function exportMedia(supabase) {
  const files = [];
  const dir = path.join(OUT, "media");
  await mkdir(dir, { recursive: true });
  for (const folder of MEDIA_FOLDERS) {
    const { data, error } = await supabase.storage.from("media").list(folder, { limit: 1000 });
    if (error) {
      console.warn(`storage/${folder}: ${error.message}`);
      continue;
    }
    for (const obj of data ?? []) {
      if (!obj.name || obj.name.endsWith("/")) continue;
      const key = `${folder}/${obj.name}`;
      const { data: blob, error: dlErr } = await supabase.storage.from("media").download(key);
      if (dlErr || !blob) {
        console.warn(`download ${key}: ${dlErr?.message ?? "vide"}`);
        continue;
      }
      const dest = path.join(dir, folder);
      await mkdir(dest, { recursive: true });
      const buf = Buffer.from(await blob.arrayBuffer());
      await writeFile(path.join(dest, obj.name), buf);
      files.push({ bucket: "media", path: key, bytes: buf.length });
    }
  }
  return files;
}

async function main() {
  await loadEnvFile(path.join(ROOT, ".env"));

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  const email = process.env.EXPORT_EMAIL;
  const password = process.env.EXPORT_PASSWORD;

  if (!url || !key) {
    console.error("URL / clé anon absentes du .env");
    process.exit(1);
  }
  if (!email || !password) {
    console.error(
      "Définis EXPORT_EMAIL et EXPORT_PASSWORD (compte admin Hexaro) puis relance.\n  EXPORT_EMAIL='toi@mail.com' EXPORT_PASSWORD='***' npm run export:data",
    );
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
  if (authError) {
    console.error("Connexion refusée:", authError.message);
    process.exit(1);
  }

  await mkdir(OUT, { recursive: true });
  const dump = { exported_at: new Date().toISOString(), source: url, tables: {} };

  for (const table of TABLES) {
    const columns = ACCOUNT_SELECT[table] ?? "*";
    process.stdout.write(`→ ${table}… `);
    let rows = await fetchAll(supabase, table, columns);
    if (table === "netflix_accounts") rows = await attachAccountPasswords(supabase, "netflix", rows);
    if (table === "spotify_accounts") rows = await attachAccountPasswords(supabase, "spotify", rows);
    dump.tables[table] = rows;
    console.log(`${rows.length} lignes`);
  }

  dump.users_inferred = harvestUsers(dump.tables);
  process.stdout.write("→ storage media… ");
  dump.media = await exportMedia(supabase);
  console.log(`${dump.media.length} fichiers`);

  const jsonPath = path.join(OUT, "data.json");
  await writeFile(jsonPath, JSON.stringify(dump, null, 2));
  await supabase.auth.signOut();

  console.log(`\nExport OK → ${jsonPath}`);
  console.log(
    "Limite Lovable : les mots de passe de connexion Auth ne sont pas copiables. Recrée les users sur TON projet (emails dans users_inferred).",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
