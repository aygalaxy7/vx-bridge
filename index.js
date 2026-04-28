export const config = {
  runtime: "edge",
};

const VX_TG = cleanOrigin(process.env.VX_TG);

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const DEFAULT_FORWARD_HEADERS = new Set([
  "host",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
]);

function cleanOrigin(raw) {
  if (!raw) return "";
  return raw.replace(/\/+$/, "");
}

function composeTargetURL(reqUrl) {
  const urlObj = new URL(reqUrl);
  return `${VX_TG}${urlObj.pathname}${urlObj.search}`;
}

function isFilteredHeader(name) {
  const n = name.toLowerCase();
  return (
    HOP_BY_HOP_HEADERS.has(n) ||
    DEFAULT_FORWARD_HEADERS.has(n) ||
    n.startsWith("x-vercel-")
  );
}

function cloneClientHeaders(reqHeaders) {
  const headers = new Headers();
  let realIp = null;
  let forwardedIp = null;

  for (const [name, value] of reqHeaders) {
    const lower = name.toLowerCase();

    if (isFilteredHeader(lower)) continue;

    if (lower === "x-real-ip") {
      realIp = value;
      continue;
    }

    if (lower === "x-forwarded-for") {
      forwardedIp = value;
      continue;
    }

    headers.set(name, value);
  }

  const clientIp = realIp || forwardedIp;
  if (clientIp) {
    headers.set("x-forwarded-for", clientIp);
  }

  return headers;
}

function makeError(message, status = 502) {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

// Main handler renamed to "bridgeHandler"
export default async function bridgeHandler(req) {
  if (!VX_TG) {
    return makeError("Misconfigured: VX_TG is not set", 500);
  }

  try {
    const upstreamUrl = composeTargetURL(req.url);
    const forwardHeaders = cloneClientHeaders(req.headers);
    const method = req.method.toUpperCase();
    const hasBody = !["GET", "HEAD"].includes(method);

    const response = await fetch(upstreamUrl, {
      method,
      headers: forwardHeaders,
      body: hasBody ? req.body : undefined,
      redirect: "manual",
      duplex: hasBody ? "half" : undefined,
    });

    return response;
  } catch (err) {
    console.error("bridge error:", err);
    return makeError("Bad Gateway: Tunnel Failed", 502);
  }
}
