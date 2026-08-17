import { getRequest } from "@tanstack/react-start/server";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 8_000;

function prune(now: number) {
  if (buckets.size < MAX_KEYS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  if (buckets.size >= MAX_KEYS) {
    const oldest = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt).slice(0, 1_000);
    for (const [key] of oldest) buckets.delete(key);
  }
}

export function clientIp(request?: Request | null) {
  const req = request ?? getRequest();
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim().slice(0, 64) || "unknown";
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export function assertRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  prune(now);
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  current.count += 1;
  if (current.count > limit) {
    throw new Error("Trop de tentatives. Réessaie dans un instant.");
  }
}

export function assertSameOrigin(request?: Request | null) {
  if (process.env.NODE_ENV !== "production") return;
  const req = request ?? getRequest();
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
  const origin = req.headers.get("origin");
  if (!origin) return;
  const expected = new URL(req.url).origin;
  if (origin !== expected) {
    throw new Error("Requête refusée.");
  }
}
