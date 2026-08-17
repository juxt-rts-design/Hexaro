import { createStart, createMiddleware, createCsrfMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { applySecurityHeaders } from "./lib/security-headers";
import { assertSameOrigin } from "./lib/rate-limit.server";

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

const originMiddleware = createMiddleware().server(async ({ next }) => {
  assertSameOrigin(getRequest());
  return next();
});

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    const result = await next();
    if (result instanceof Response) {
      applySecurityHeaders(result.headers, getRequest());
    }
    return result;
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
    applySecurityHeaders(headers, getRequest());
    return new Response(renderErrorPage(), { status: 500, headers });
  }
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [csrfMiddleware, originMiddleware, errorMiddleware],
}));
