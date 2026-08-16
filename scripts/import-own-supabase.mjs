import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function isNewSupabaseApiKey(value) {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createSupabaseFetch(supabaseKey) {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    if (isNewSupabaseApiKey(supabaseKey) && headers.get("Authorization") === `Bearer ${supabaseKey}`) {
      headers.delete("Authorization");
    }
    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

function makeAdmin(url, service) {
  return createClient(url, service, {
    global: { fetch: createSupabaseFetch(service) },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const ROOT = process.cwd();
const DUMP = path.join(ROOT, "exports", "lovable-dump", "data.json");
const MEDIA = path.join(ROOT, "exports", "lovable-dump", "media");

const REPLACE_TABLES = new Set(["services", "internet_forfaits"]);
const INSERT_ORDER = [
  "services",
  "internet_forfaits",
  "clients",
  "netflix_accounts",
  "spotify_accounts",
  "netflix_profiles",
  "spotify_members",
  "internet_subscriptions",
  "payments",
  "notifications",
  "activity_logs",
];

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

async function upsertTable(admin, table, rows) {
  if (!rows?.length) {
    console.log(`→ ${table}: 0`);
    return;
  }
  const chunk = 200;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const { error } = await admin.from(table).upsert(slice, { onConflict: "id" });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  console.log(`→ ${table}: ${rows.length}`);
}

async function replaceTable(admin, table, rows) {
  const { error: delErr } = await admin.from(table).delete().not("id", "is", null);
  if (delErr) throw new Error(`${table} delete: ${delErr.message}`);
  await upsertTable(admin, table, rows);
}

async function importMedia(admin) {
  if (!existsSync(MEDIA)) {
    console.log("→ media: dossier absent, skip");
    return;
  }
  const folders = await readdir(MEDIA, { withFileTypes: true });
  let count = 0;
  for (const folder of folders.filter((d) => d.isDirectory())) {
    const files = await readdir(path.join(MEDIA, folder.name));
    for (const name of files) {
      const buf = await readFile(path.join(MEDIA, folder.name, name));
      const key = `${folder.name}/${name}`;
      const { error } = await admin.storage.from("media").upload(key, buf, { upsert: true });
      if (error) console.warn(`upload ${key}: ${error.message}`);
      else count += 1;
    }
  }
  console.log(`→ media: ${count} fichiers`);
}

function fallbackEmail(u) {
  if (u.email) return u.email;
  const slug = String(u.full_name || "user")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.|\.$/g, "") || "user";
  return `${slug}.${String(u.id).slice(0, 8)}@imported.hexaro.local`;
}

async function recreateUsers(admin, users, fallbackPassword) {
  const { data: listed, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) throw new Error(`listUsers: ${listErr.message}`);
  const byEmail = new Map((listed.users ?? []).map((u) => [u.email, u]));

  let created = 0;
  for (const u of users ?? []) {
    const email = fallbackEmail(u);
    if (!u.email) {
      console.warn(`user ${u.id} sans email Lovable → ${email}`);
    }
    const existing = byEmail.get(email);
    if (existing && existing.id !== u.id) {
      console.warn(`email ${email} avait l'id ${existing.id} → recréé en ${u.id}`);
      const { error: delErr } = await admin.auth.admin.deleteUser(existing.id);
      if (delErr) throw new Error(`deleteUser ${email}: ${delErr.message}`);
    } else if (existing && existing.id === u.id) {
      created += 1;
      continue;
    }
    const { error } = await admin.auth.admin.createUser({
      id: u.id,
      email,
      password: fallbackPassword,
      email_confirm: true,
      user_metadata: { full_name: u.full_name ?? "" },
    });
    if (error && !/already|registered|exists/i.test(error.message)) {
      console.warn(`auth ${email}: ${error.message}`);
      continue;
    }
    created += 1;
  }
  console.log(`→ auth.users: ${created} (mdp temporaire IMPORT_USER_PASSWORD)`);
}

async function main() {
  await loadEnvFile(path.join(ROOT, ".env"));

  const url = process.env.TARGET_SUPABASE_URL;
  const service = process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY;
  const tempPassword = process.env.IMPORT_USER_PASSWORD || "ChangeMoi-Hexaro-2026";

  if (!url || !service) {
    console.error(
      "Définis TARGET_SUPABASE_URL et TARGET_SUPABASE_SERVICE_ROLE_KEY (TON projet, pas Lovable).",
    );
    process.exit(1);
  }
  if (!existsSync(DUMP)) {
    console.error("Pas de dump. Lance d'abord npm run export:data");
    process.exit(1);
  }

  const dump = JSON.parse(await readFile(DUMP, "utf8"));
  const admin = makeAdmin(url, service);

  const { error: bucketErr } = await admin.storage.createBucket("media", { public: false });
  if (bucketErr && !/exists|duplicate|already/i.test(bucketErr.message)) {
    console.warn("bucket media:", bucketErr.message);
  } else {
    console.log("→ bucket media OK");
  }

  await recreateUsers(admin, dump.users_inferred, tempPassword);
  await upsertTable(admin, "profiles", dump.tables.profiles);
  await upsertTable(admin, "user_roles", dump.tables.user_roles);

  for (const table of INSERT_ORDER) {
    const rows = dump.tables[table];
    if (REPLACE_TABLES.has(table)) await replaceTable(admin, table, rows);
    else await upsertTable(admin, table, rows);
  }
  await importMedia(admin);
  console.log("\nImport OK. Fais changer les mots de passe des comptes recréés.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
