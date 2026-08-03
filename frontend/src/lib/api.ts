import { API_URL } from "./config";

let csrfToken: string | null = null;
let csrfRequest: Promise<string> | null = null;
let refreshRequest: Promise<boolean> | null = null;

async function getCsrfToken() {
  if (csrfToken) return csrfToken;
  if (!csrfRequest) {
    csrfRequest = fetch(`${API_URL}/api/auth/csrf`, { credentials: "include", cache: "no-store" })
      .then(async response => {
        const payload = await response.json().catch(() => ({})) as { token?: string };
        if (!response.ok || !payload.token) throw new Error("Unable to initialize request security");
        csrfToken = payload.token;
        return payload.token;
      })
      .finally(() => { csrfRequest = null; });
  }
  return csrfRequest;
}

async function refreshSession() {
  if (!refreshRequest) {
    refreshRequest = (async () => {
      try {
        const token = await getCsrfToken();
        const response = await fetch(`${API_URL}/api/auth/refresh`, { method: "POST", headers: { "X-CSRF-Token": token }, credentials: "include", cache: "no-store" });
        return response.ok;
      } catch { return false; }
    })().finally(() => { refreshRequest = null; });
  }
  return refreshRequest;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (["POST", "PUT", "PATCH", "DELETE"].includes((init.method || "GET").toUpperCase())) headers.set("X-CSRF-Token", await getCsrfToken());
  let response = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: "include", cache: "no-store" });
  if (response.status === 401 && path !== "/api/auth/refresh" && path !== "/api/auth/verify" && path !== "/api/auth/nonce" && await refreshSession()) {
    response = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: "include", cache: "no-store" });
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload as T;
}

export function shortenAddress(address?: string | null) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Not connected";
}
