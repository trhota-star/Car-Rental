// Minimal cookie-jar HTTP client for authorization tests against a running server.
export const BASE_URL = process.env.QA_BASE_URL ?? process.env.E2E_BASE_URL ?? "http://localhost:3100";

export class HttpSession {
  private cookies = new Map<string, string>();
  constructor(readonly baseURL = BASE_URL) {}

  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  async request(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookies.size) headers.set("cookie", this.cookieHeader());
    // Better Auth checks Origin on state-changing requests.
    headers.set("origin", this.baseURL);
    let body = init.body;
    if (init.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(init.json);
    }
    const res = await fetch(new URL(path, this.baseURL), { ...init, headers, body, redirect: "manual" });
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      const expired = attrs.some((a) => /max-age=0\b/i.test(a.trim())) || value === "";
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return res;
  }

  signUp(email: string, password: string, name = "QA User") {
    return this.request("/api/auth/sign-up/email", { method: "POST", json: { email, password, name } });
  }
  signIn(email: string, password: string) {
    return this.request("/api/auth/sign-in/email", { method: "POST", json: { email, password } });
  }
  signOut() {
    return this.request("/api/auth/sign-out", { method: "POST", json: {} });
  }
  async session(): Promise<{ user?: { id: string; email: string; role?: string } } | null> {
    const res = await this.request("/api/auth/get-session");
    return res.ok ? res.json() : null;
  }
}

/** Accept 401/403/404 or a redirect to login as "denied". */
export function isDenied(res: Response): boolean {
  if ([401, 403, 404].includes(res.status)) return true;
  if (res.status >= 300 && res.status < 400) return /login|sign-in|signin/i.test(res.headers.get("location") ?? "");
  return false;
}

export async function serverIsUp(baseURL = BASE_URL): Promise<boolean> {
  try {
    await fetch(baseURL, { redirect: "manual", signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}
