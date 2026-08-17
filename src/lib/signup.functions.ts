import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  full_name: z.string().min(2).max(120),
});

export const signUpAccount = createServerFn({ method: "POST" })
  .inputValidator((v: unknown) => schema.parse(v))
  .handler(async () => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { assertRateLimit, clientIp } = await import("@/lib/rate-limit.server");
    assertRateLimit(`signup:${clientIp(getRequest())}`, 5, 15 * 60_000);
    throw new Error("L’inscription publique est fermée. Demande un accès à l’administrateur.");
  });

export const gateAuthAttempt = createServerFn({ method: "POST" })
  .inputValidator((v: unknown) =>
    z.object({ email: z.string().email().max(254).optional() }).parse(v ?? {}),
  )
  .handler(async ({ data }) => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { assertRateLimit, clientIp } = await import("@/lib/rate-limit.server");
    const ip = clientIp(getRequest());
    assertRateLimit(`auth-ip:${ip}`, 12, 15 * 60_000);
    if (data.email) {
      assertRateLimit(`auth-email:${data.email.trim().toLowerCase()}`, 5, 15 * 60_000);
    }
    return { ok: true as const };
  });
