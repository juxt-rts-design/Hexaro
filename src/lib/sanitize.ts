export function stripTags(value: string) {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/javascript:/gi, "")
    .replace(/on\w+\s*=/gi, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim();
}

export function safeText(value: unknown, max = 500) {
  if (value == null) return "";
  return stripTags(String(value)).slice(0, max);
}
