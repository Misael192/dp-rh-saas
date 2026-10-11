import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const deployment = process.env.DEPLOYMENT_ENV ?? process.env.NODE_ENV;
  const production = deployment === "production";
  const developmentRuntime = process.env.NODE_ENV !== "production";
  const httpsOrigin = (process.env.WEB_ORIGIN ?? "").startsWith("https://");
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${developmentRuntime ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self'${developmentRuntime ? " ws: wss:" : ""}`,
    "img-src 'self' data:", "font-src 'self'", "object-src 'none'",
    "base-uri 'self'", "frame-ancestors 'none'", "form-action 'self'",
    ...(production && httpsOrigin ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "private, no-store");
  if (production && httpsOrigin) response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return response;
}
export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"] };
