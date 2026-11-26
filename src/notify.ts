/**
 * Phone notifications through ntfy (https://ntfy.sh): free iOS/Android app, no account.
 * The office POSTs JSON to the ntfy server; the phone subscribed to the topic shows it.
 * Approve / Reject buttons call back into the office through short-lived signed links.
 */

export interface NtfyMessage {
  topic: string;
  title: string;
  message: string;
  priority?: 1 | 2 | 3 | 4 | 5;
  tags?: string[];
  click?: string;
  actions?: Array<
    | { action: "view"; label: string; url: string; clear?: boolean }
    | { action: "http"; label: string; url: string; method?: "POST" | "GET"; clear?: boolean }
  >;
}

export function isValidTopic(topic: string): boolean {
  return /^[A-Za-z0-9_-]{12,64}$/.test(topic);
}

export function normalizeServer(raw: string): string | null {
  const s = (raw || "").trim().replace(/\/+$/, "") || "https://ntfy.sh";
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" || u.username || u.password || u.search) return null;
    return `${u.origin}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return null;
  }
}

export function randomTopic(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `hq-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function b64url(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}

export async function signAction(secret: string, needId: string, action: string, expMs: number): Promise<string> {
  return hmac(secret, `${needId}|${action}|${expMs}`);
}

export async function verifyAction(
  secret: string,
  needId: string,
  action: string,
  expMs: number,
  sig: string,
  nowMs: number = Date.now()
): Promise<boolean> {
  if (!secret || !needId || !sig || !Number.isFinite(expMs) || expMs < nowMs) return false;
  if (action !== "approve" && action !== "reject") return false;
  const expected = await signAction(secret, needId, action, expMs);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

export async function actionUrl(origin: string, secret: string, needId: string, action: "approve" | "reject", nowMs: number = Date.now()): Promise<string> {
  const exp = nowMs + 7 * 24 * 60 * 60_000;
  const sig = await signAction(secret, needId, action, exp);
  const q = new URLSearchParams({ n: needId, a: action, exp: String(exp), sig });
  return `${origin}/api/notify/act?${q.toString()}`;
}

/** ntfy caps messages at 4096 bytes; keep well under. */
export function clip(text: string, max = 900): string {
  const t = (text || "").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
