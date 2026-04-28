// Vercel Edge runtime configuration — ensures execution at the Edge layer.
export const config = { runtime: "edge" };

// Base URL of the upstream target; read from environment variable VX_TG.
// Removes any trailing slash for consistent concatenation.
const VX_TARGET_BASE = (process.env.VX_TG || "").replace(/\/$/, "");

// These are HTTP header names that must NOT be forwarded upstream.
// These are protocol-defined hop‑by‑hop headers and platform-specific headers.
// DO NOT change the string values — behavior depends on these exact names.
const VX_FILTERED_HEADERS = new Set([
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
 * Main proxy handler — receives the incoming request on Vercel Edge
 * and forwards it to the configured VX_TG domain.
 */
export default async function bridgeHandler(req) {
  // Ensure environment variable is configured correctly.
  if (!VX_TARGET_BASE) {
    return new Response("Misconfigured: VX_TG is not set", { status: 500 });
  }

  try {
    // Extract the path portion of the URL starting after protocol+domain.
    // indexOf("/", 8) skips "https://".
    const pathStart = req.url.indexOf("/", 8);

    // Reconstruct upstream URL.
    const targetUrl =
      pathStart === -1
        ? VX_TARGET_BASE + "/"
        : VX_TARGET_BASE + req.url.slice(pathStart);

    // Prepare new headers by stripping hop-by-hop and Vercel-specific headers.
    const out = new Headers();
    let clientIp = null;

    for (const [k, v] of req.headers) {
      if (VX_FILTERED_HEADERS.has(k)) continue;
      if (k.startsWith("x-vercel-")) continue;

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

    // Preserve client IP chain.
    if (clientIp) out.set("x-forwarded-for", clientIp);

    // Determine whether request has a body.
    const method = req.method;
    const hasBody = method !== "GET" && method !== "HEAD";

    // Forward request to upstream target.
    return await fetch(targetUrl, {
      method,
      headers: out,
      body: hasBody ? req.body : undefined,
      duplex: "half", // streaming support required for Edge
      redirect: "manual", // return upstream redirects directly
    });
  } catch (err) {
    console.error("bridge error:", err);
    return new Response("Bad Gateway: Tunnel Failed", { status: 502 });
  }
}
