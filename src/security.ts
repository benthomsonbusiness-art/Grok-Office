const encoder = new TextEncoder();

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' ws: wss:; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
};

export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(k)) {
      headers.set(k, v);
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Constant-time comparison using SHA-256 digests so lengths never leak timing info.
 */
export async function timingSafeEqualStrings(a: string, b: string): Promise<boolean> {
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const viewA = new Uint8Array(hashA);
  const viewB = new Uint8Array(hashB);
  let diff = 0;
  for (let i = 0; i < viewA.length; i++) {
    diff |= viewA[i] ^ viewB[i];
  }
  return diff === 0;
}

async function getHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(`grok-office-session-v1:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(str: string): Uint8Array | null {
  try {
    const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export async function createSessionCookieValue(secret: string, ttlSeconds = 86400 * 7): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const nonce = toBase64Url(crypto.getRandomValues(new Uint8Array(12)));
  const payload = `${exp}.${nonce}`;
  const key = await getHmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return `${payload}.${toBase64Url(sig)}`;
}

export async function verifySessionCookieValue(cookieValue: string, secret: string): Promise<boolean> {
  const parts = cookieValue.split(".");
  if (parts.length !== 3) return false;
  const [expStr, nonce, sigStr] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000) || !nonce) {
    return false;
  }
  const sigBytes = fromBase64Url(sigStr);
  if (!sigBytes) return false;
  const key = await getHmacKey(secret);
  return crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(`${expStr}.${nonce}`));
}

export function parseCookies(cookieHeader: string | null): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    result[key] = val;
  }
  return result;
}

/**
 * Validates optional webhook callbackUrl / deliverable URLs to prevent SSRF against localhost / private ranges.
 */
export function isSafeCallbackUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    const rawHost = parsed.hostname.toLowerCase();
    if (!rawHost) return false;

    // Strip brackets from IPv6 literals
    const isIpv6 = rawHost.startsWith("[") && rawHost.endsWith("]");
    const host = isIpv6 ? rawHost.slice(1, -1) : rawHost;

    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal")
    ) {
      return false;
    }

    if (isIpv6 || host.includes(":")) {
      // Block loopback (::1), unspecified (::), IPv4-mapped (::ffff:*), ULA (fc00::/7), link-local (fe80::/10), multicast (ff00::/8)
      if (
        host === "::" ||
        host === "::1" ||
        host.startsWith("::ffff:") ||
        host.startsWith("0:") ||
        host.startsWith("0000:") ||
        /^f[cd][0-9a-f]{2}:/i.test(host) ||
        /^fe[89ab][0-9a-f]:/i.test(host) ||
        /^ff[0-9a-f]{2}:/i.test(host) ||
        /^::[0-9a-f.]+$/i.test(host)
      ) {
        return false;
      }
      return true;
    }

    // Reject single-integer or hex/octal IPv4 obfuscations (e.g., 2130706433, 0x7f000001)
    if (/^(0x[0-9a-f]+|\d+)$/i.test(host)) return false;

    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
      const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
      if (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 192 && b === 0) ||
        (a === 198 && (b === 18 || b === 19)) ||
        a >= 224
      ) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

export function clampText(input: unknown, maxLen: number, fallback = ""): string {
  if (typeof input !== "string") return fallback;
  const trimmed = input.trim();
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

export function sanitizeHexColor(input: unknown, fallback: string): string {
  if (typeof input !== "string") return fallback;
  return /^#[0-9a-fA-F]{6}$/.test(input.trim()) ? input.trim() : fallback;
}
