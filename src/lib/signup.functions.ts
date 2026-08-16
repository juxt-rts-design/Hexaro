import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  full_name: z.string().min(2).max(120),
});

export const signUpAccount = createServerFn({ method: "POST" })
  .inputValidator((v: unknown) => schema.parse(v))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email.trim().toLowerCase(),
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name.trim() },
    });
    if (error || !created?.user) {
      const msg = error?.message ?? "Inscription impossible";
      if (/already|registered|exists/i.test(msg)) {
        throw new Error("Un compte existe déjà avec cet email. Connectez-vous.");
      }
      throw new Error(msg);
    }
    return { ok: true as const };
  });
