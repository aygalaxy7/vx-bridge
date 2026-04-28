// Vercel Edge runtime configuration — ensures this file runs at the Edge layer.
export const config = { runtime: "edge" };

// Base URL of the upstream target; read from environment variable VX_TG.
// Trailing slash is removed for consistency.
const VX_TARGET_BASE = (process.env.VX_TG || "").replace(/\/$/, "");

// Headers that must NOT be forwarded (hop-by-hop or Vercel-specific).
// These are stripped out before proxying requests upstream.
const VX_STRIP_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
]);

/**
 * Main proxy handler — receives the incoming request from Vercel
 * and forwards it to the configured VX_TG domain.
 * Preserves headers, method, and body as much as possible.
 */
export default async function bridgeHandler(req) {
  // Ensure configuration is valid before proceeding.
  if (!VX_TARGET_BASE) {
    return new Response("Misconfigured: VX_TG is not set", { status: 500 });
  }

  try {
    // Compute the target URL based on the incoming request path.
    // The "8" offset skips the protocol + domain portion of the URL.
    const pathStart = req.url.indexOf("/", 8);
    const targetUrl =
      pathStart === -1
        ? VX_TARGET_BASE + "/"
        : VX_TARGET_BASE + req.url.slice(pathStart);

    // Prepare filtered headers — drop hop-by-hop and platform headers.
    const out = new Headers();
    let clientIp = null;
    for (const [k, v] of req.headers) {
      if (VX_STRIP_HEADERS.has(k)) continue;
      if (k.startsWith("x-vercel-")) continue;

      // Capture real client IP if provided.
      if (k === "x-real-ip") {
        clientIp = v;
        continue;
      }
      if (k === "x-forwarded-for") {
        if (!clientIp) clientIp = v;
        continue;
      }
      out.set(k, v);
    }

    // Preserve the client IP chain upstream.
    if (clientIp) out.set("x-forwarded-for", clientIp);

    // Maintain original HTTP method and body presence.
    const method = req.method;
    const hasBody = method !== "GET" && method !== "HEAD";

    // Forward the request to the upstream target.
    return await fetch(targetUrl, {
      method,
      headers: out,
      body: hasBody ? req.body : undefined,
      duplex: "half", // required for streaming body support on Edge runtime
      redirect: "manual", // do not automatically follow redirects; return directly
    });
  } catch (err) {
    console.error("bridge error:", err);
    return new Response("Bad Gateway: Tunnel Failed", { status: 502 });
  }
}
