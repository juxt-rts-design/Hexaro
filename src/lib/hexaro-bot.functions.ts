import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertStaff } from "@/lib/assert-staff";

const msgSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
});

const inputSchema = z.object({
  messages: z.preprocess(
    (v) => (Array.isArray(v) ? v.slice(-16) : v),
    z.array(msgSchema).min(1).max(16),
  ),
});

export const askHexaroBot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => inputSchema.parse(v))
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { assertRateLimit } = await import("@/lib/rate-limit.server");
    assertRateLimit(`bot:${context.userId}`, 20, 5 * 60_000);
    const { runHexaroBot } = await import("./hexaro-bot.server");
    return runHexaroBot(context.supabase, context.userId, data.messages, {
      email: String(context.claims.email ?? ""),
      name: String(context.claims.user_metadata?.full_name ?? context.claims.name ?? ""),
    });
  });

export const warmHexaroBot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context.supabase, context.userId);
    const { assertRateLimit } = await import("@/lib/rate-limit.server");
    assertRateLimit(`bot-warm:${context.userId}`, 30, 5 * 60_000);
    const { warmSnapshot } = await import("./hexaro-bot.server");
    await warmSnapshot(context.supabase, context.userId);
    return { ok: true as const };
  });
