export function corsHeaders() {
  const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN");
  return {
    ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin } : {}),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders() });
}

export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<
  | { ok: true; value: unknown }
  | { ok: false; error: string; status: 400 | 413 | 415 }
> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return { ok: false, error: "Content-Type must be application/json.", status: 415 };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, error: "A JSON request body is required.", status: 400 };

  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return { ok: false, error: "Request body is too large.", status: 413 };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, error: "Request body must be valid JSON.", status: 400 };
  }
}

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomAlias(length = 12) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export function serviceConfig() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase server configuration is incomplete.");
  return { url: url.replace(/\/$/, ""), key };
}

export async function databaseRequest(path: string, init: RequestInit = {}) {
  const { url, key } = serviceConfig();
  const headers = new Headers(init.headers);
  headers.set("apikey", key);
  headers.set("Authorization", `Bearer ${key}`);
  headers.set("Content-Type", "application/json");
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers,
  });
  const body = await response.text();
  if (!response.ok) {
    console.error("Supabase database request failed:", response.status, body);
    throw new Error("The inbox service could not complete the request.");
  }
  return body ? JSON.parse(body) : null;
}

export async function rateLimit(
  request: Request,
  scope: string,
  limit: number,
  windowSeconds = 60,
  includeClientIp = true,
) {
  const clientIp = request.headers.get("cf-connecting-ip")?.trim() || "unknown";
  const keyHash = await sha256(`quickmail:${scope}:${includeClientIp ? clientIp : "global"}`);
  const allowed = await databaseRequest("rpc/consume_quickmail_rate_limit", {
    method: "POST",
    body: JSON.stringify({
      p_key_hash: keyHash,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    }),
  });
  return allowed === true;
}

export function constantTimeEquals(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export function isPostRequest(request: Request) {
  return request.method === "POST";
}
