export const PROXY_BODY_LIMIT = 65_536;
export const PROXY_BODY_TOO_LARGE = "Payload too large (max 64 KB)";

export type GuardrailPayload = { blocked?: boolean; reason?: string };

export type GuardrailVerdict =
  | { action: "forward" }
  | { action: "block"; reason: string }
  | { action: "unavailable" };

export async function readProxyBody(
  request: Request,
  limit = PROXY_BODY_LIMIT
): Promise<{ ok: true; bytes: Uint8Array | null } | { ok: false; error: string }> {
  if (request.method === "GET" || request.method === "HEAD") {
    return { ok: true, bytes: null };
  }
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limit) {
    return { ok: false, error: PROXY_BODY_TOO_LARGE };
  }
  if (!request.body) return { ok: true, bytes: new Uint8Array(0) };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.byteLength === 0) continue;
    total += value.byteLength;
    if (total > limit) {
      try {
        await reader.cancel();
      } catch {
        // The cap is already exceeded; stop reading.
      }
      return { ok: false, error: PROXY_BODY_TOO_LARGE };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

/** Forward only when the guardrail response is ok and blocked is not true. */
export async function resolveGuardrail(check: () => Promise<Response>): Promise<GuardrailVerdict> {
  let resp: Response;
  try {
    resp = await check();
  } catch {
    return { action: "unavailable" };
  }
  if (!resp.ok) return { action: "unavailable" };
  let data: GuardrailPayload | null;
  try {
    data = (await resp.json()) as GuardrailPayload;
  } catch {
    return { action: "unavailable" };
  }
  if (!data || typeof data !== "object") return { action: "unavailable" };
  if (data.blocked === true) return { action: "block", reason: typeof data.reason === "string" ? data.reason : "" };
  return { action: "forward" };
}

/**
 * Runs the guardrail and body cap, then calls `forward` only when both allow it.
 */
export async function runProxyGuard(options: {
  request: Request;
  checkGuardrail: () => Promise<Response>;
  forward: (body: Uint8Array | null) => Promise<Response>;
  onUnavailable: () => Response;
  onBlocked: (reason: string) => Response;
  onTooLarge: (error: string) => Response;
}): Promise<Response> {
  const verdict = await resolveGuardrail(options.checkGuardrail);
  if (verdict.action === "unavailable") return options.onUnavailable();
  if (verdict.action === "block") return options.onBlocked(verdict.reason);
  const body = await readProxyBody(options.request);
  if (!body.ok) return options.onTooLarge(body.error);
  return options.forward(body.bytes);
}
