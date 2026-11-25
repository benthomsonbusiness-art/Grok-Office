export const MAX_PROXY_BODY_BYTES = 65_536;

export interface GuardrailPayload {
  blocked?: boolean;
  reason?: string;
}

export type GuardrailAssessment =
  | { action: "forward" }
  | { action: "block"; reason: string }
  | { action: "unavailable" };

export function assessGuardrail(input: {
  threw: boolean;
  ok: boolean;
  parsed: GuardrailPayload | null;
}): GuardrailAssessment {
  if (input.threw || !input.ok || input.parsed === null) {
    return { action: "unavailable" };
  }
  if (input.parsed.blocked === true) {
    return { action: "block", reason: input.parsed.reason || "Daily cap reached" };
  }
  return { action: "forward" };
}

export function proxyBlockedResponse(reason: string): {
  status: number;
  body: {
    error: { message: string; type: string; code: string };
  };
} {
  return {
    status: 429,
    body: {
      error: {
        message: `Grok Bot HQ Guardrail Circuit-Breaker: ${reason}`,
        type: "office_budget_cap_exceeded",
        code: "daily_budget_cap_reached",
      },
    },
  };
}

export function proxyUnavailableResponse(): { status: number; body: { error: string } } {
  return { status: 503, body: { error: "Guardrail unavailable" } };
}

export function payloadTooLargeResponse(): { status: number; body: { error: string } } {
  return { status: 413, body: { error: "Payload too large (max 64 KB)" } };
}

/**
 * Read a request body without buffering past the cap.
 * A declared content-length over the cap returns before any read.
 */
export async function readCappedBody(
  request: Request,
  maxBytes = MAX_PROXY_BODY_BYTES
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false }> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false };
  }
  if (request.method === "GET" || request.method === "HEAD" || !request.body) {
    return { ok: true, bytes: new Uint8Array() };
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false };
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => {});
    return { ok: false };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

export async function loadGuardrail(guardFetch: () => Promise<Response>): Promise<GuardrailAssessment> {
  try {
    const response = await guardFetch();
    if (!response.ok) return { action: "unavailable" };
    try {
      const parsed = (await response.json()) as GuardrailPayload;
      if (!parsed || typeof parsed !== "object") return { action: "unavailable" };
      return assessGuardrail({ threw: false, ok: true, parsed });
    } catch {
      return { action: "unavailable" };
    }
  } catch {
    return { action: "unavailable" };
  }
}
