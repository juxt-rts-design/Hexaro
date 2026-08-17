const CSP_PROD = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "frame-src 'self' https://*.supabase.co blob:",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests",
].join("; ");

const CSP_DEV = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: http: https:",
  "font-src 'self' data:",
  "connect-src 'self' http: https: ws: wss:",
  "frame-src 'self' https://*.supabase.co blob:",
  "worker-src 'self' blob:",
].join("; ");

export function securityHeaderMap(opts: { dev: boolean; https: boolean }): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "X-DNS-Prefetch-Control": "off",
    "X-Robots-Tag": "noindex, nofollow",
    "Content-Security-Policy": opts.dev ? CSP_DEV : CSP_PROD,
  };
  if (opts.https && !opts.dev) {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }
  return headers;
}

export function applySecurityHeaders(headers: Headers, request: Request) {
  const url = new URL(request.url);
  const dev = process.env.NODE_ENV !== "production";
  const map = securityHeaderMap({ dev, https: url.protocol === "https:" });
  for (const [key, value] of Object.entries(map)) {
    if (!headers.has(key)) headers.set(key, value);
  }
}

export function withSecurityHeaders(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  applySecurityHeaders(headers, request);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function publicError(err: unknown, fallback = "Une erreur s’est produite.") {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  if (
    /trop de tentatives|accès refusé|session expirée|inscription|reconnect|réservé|bloqué/i.test(
      raw,
    )
  ) {
    return raw;
  }
  if (/[àâéèêëîïôùûç]/i.test(raw) && raw.length < 160 && !/sql|postgres|jwt|api key|stack|supabase/i.test(raw)) {
    return raw;
  }
  return fallback;
}

export function safeUploadName(name: string) {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "fichier";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^[.-]+/, "").slice(0, 80);
  return cleaned || "fichier";
}
