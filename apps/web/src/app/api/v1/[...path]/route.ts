import { NextRequest, NextResponse } from "next/server";
import { isIP } from "node:net";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BODY_LIMIT = 64 * 1024;
async function boundedBody(request: NextRequest): Promise<ArrayBuffer | undefined> {
  const size = Number(request.headers.get("content-length"));
  if (Number.isFinite(size) && size > BODY_LIMIT) throw new RangeError("body limit");
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > BODY_LIMIT) { await reader.cancel(); throw new RangeError("body limit"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output.buffer;
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const base = new URL(process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000");
  if (!["http:", "https:"].includes(base.protocol)) return NextResponse.json({ message: "Configuração da API inválida." }, { status: 503 });
  const target = new URL(`/api/v1/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`, base);
  const headers = new Headers();
  for (const name of ["content-type", "cookie", "origin", "x-csrf-token", "accept"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Ingress must overwrite this configured header. Generic X-Forwarded-For is
  // never accepted. Deployment must prevent bypassing the authoritative ingress.
  const proxySecret = process.env.API_PROXY_SECRET;
  const trustedHeader = process.env.TRUSTED_PROXY_HEADER;
  const productionDeployment = (process.env.DEPLOYMENT_ENV ?? process.env.NODE_ENV) === "production";
  if (productionDeployment && (!proxySecret || proxySecret.length < 32 || !trustedHeader)) return NextResponse.json({ message: "Proxy de segurança não configurado." }, { status: 503 });
  if (trustedHeader && proxySecret) {
    const clientIp = request.headers.get(trustedHeader)?.trim();
    if (!clientIp || !isIP(clientIp)) return NextResponse.json({ message: "Identificação do cliente indisponível." }, { status: 503 });
    headers.set("x-peopleflow-proxy-key", proxySecret);
    headers.set("x-peopleflow-client-ip", clientIp);
  }
  try {
    const body = ["GET", "HEAD"].includes(request.method) ? undefined : await boundedBody(request);
    const upstream = await fetch(target, { method: request.method, headers, body, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(15000) });
    const output = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    const contentType = upstream.headers.get("content-type");
    if (contentType) output.set("content-type", contentType);
    for (const cookie of upstream.headers.getSetCookie()) output.append("set-cookie", cookie);
    return new Response(upstream.body, { status: upstream.status, headers: output });
  } catch (error) {
    if (error instanceof RangeError) return NextResponse.json({ message: "Requisição muito grande." }, { status: 413 });
    return NextResponse.json({ message: "Não foi possível acessar a API. Tente novamente em instantes." }, { status: 503 });
  }
}
export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
