export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); this.name = "ApiError"; }
}

let csrfToken: string | null = null;
let csrfRequest: Promise<string> | null = null;
let refreshRequest: Promise<boolean> | null = null;

async function getCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  if (!csrfRequest) csrfRequest = (async () => {
    const response = await fetch("/api/v1/auth/csrf", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new ApiError(response.status, "Não foi possível preparar a sessão segura. Tente novamente.");
    const data = await response.json() as { csrfToken: string };
    if (!data.csrfToken) throw new ApiError(502, "O servidor não retornou a proteção de sessão.");
    csrfToken = data.csrfToken;
    return csrfToken;
  })().finally(() => { csrfRequest = null; });
  return csrfRequest;
}

async function refreshSession(): Promise<boolean> {
  if (!refreshRequest) refreshRequest = (async () => {
    // Rotation is serialized across tabs. A sibling may already have renewed
    // the shared cookies while this tab waited for the lock.
    if (!navigator.locks) return false;
    return navigator.locks.request("peopleflow-auth-refresh", async () => {
      try {
        const current = await fetch("/api/v1/auth/me", { credentials: "same-origin", cache: "no-store" });
        if (current.ok) return true;
        if (current.status !== 401) return false;
        const send = async () => fetch("/api/v1/auth/refresh", { method: "POST", credentials: "same-origin", headers: { "x-csrf-token": await getCsrfToken(), "Content-Type": "application/json" }, body: "{}", cache: "no-store" });
        let response = await send();
        if (response.status === 403) {
          const error = await response.json().catch(() => null) as { code?: string } | null;
          if (error?.code === "CSRF_REJECTED") { csrfToken = null; response = await send(); }
        }
        return response.ok;
      } catch { return false; }
    });
  })().finally(() => { refreshRequest = null; });
  return refreshRequest;
}

type RequestOptions = { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown; signal?: AbortSignal; retryAuth?: boolean; retryCsrf?: boolean };
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {};
  if (method !== "GET") headers["x-csrf-token"] = await getCsrfToken();
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && options.body === undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`/api/v1${path}`, { method, credentials: "same-origin", headers, body: method === "GET" ? undefined : JSON.stringify(options.body ?? {}), signal: options.signal, cache: "no-store" });
  if (response.status === 401 && options.retryAuth !== false && !["/auth/login", "/auth/refresh", "/auth/logout"].includes(path) && await refreshSession()) {
    return api<T>(path, { ...options, retryAuth: false });
  }
  const data: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = data as { message?: string | string[]; code?: string } | undefined;
    // This code is emitted by the pre-mutation guard, so one replay cannot
    // duplicate an operation that already ran. Never retry arbitrary 403s.
    if (response.status === 403 && error?.code === "CSRF_REJECTED" && options.retryCsrf !== false && method !== "GET") {
      csrfToken = null;
      return api<T>(path, { ...options, retryCsrf: false });
    }
    const message = Array.isArray(error?.message) ? error.message.join(". ") : error?.message;
    if (response.status === 401 && path !== "/auth/login") window.dispatchEvent(new Event("peopleflow:session-expired"));
    throw new ApiError(response.status, message || (response.status === 429 ? "Muitas tentativas. Aguarde um pouco e tente novamente." : "Não foi possível concluir a operação."), error?.code);
  }
  return data as T;
}

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Ocorreu um erro inesperado. Tente novamente.";
export function clearApiSession() { csrfToken = null; }
