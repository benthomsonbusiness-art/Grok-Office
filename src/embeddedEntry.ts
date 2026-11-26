/**
 * Alternate entry that serves public/ from the Worker bundle instead of the
 * Workers Assets binding. Used by `npm run deploy:embedded`.
 */
import worker, { OfficeHub } from "./index";
import { EMBEDDED_ASSETS } from "./generated/assets";

export { OfficeHub };

const embeddedAssets = {
  async fetch(input: Request | string): Promise<Response> {
    const req = typeof input === "string" ? new Request(input) : input;
    let path = new URL(req.url).pathname;
    if (path === "/") path = "/index.html";
    const asset = EMBEDDED_ASSETS[path];
    if (!asset) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
    const body = asset.base64 ? Uint8Array.from(atob(asset.body), (c) => c.charCodeAt(0)) : asset.body;
    return new Response(req.method === "HEAD" ? null : body, {
      headers: {
        "content-type": asset.type,
        "cache-control": path === "/index.html" || path === "/sw.js" ? "no-cache" : "public, max-age=300",
      },
    });
  },
};

export default {
  fetch(request: Request, env: Record<string, unknown>, ctx: ExecutionContext) {
    const wrapped = Object.assign(Object.create(env), { ASSETS: embeddedAssets });
    return (worker.fetch as (r: Request, e: unknown, c: ExecutionContext) => Promise<Response>)(request, wrapped, ctx);
  },
} satisfies ExportedHandler<Record<string, unknown>>;
