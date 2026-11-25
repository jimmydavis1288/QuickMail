import { corsHeaders, databaseRequest, isPostRequest, jsonResponse, randomAlias, rateLimit, sha256 } from "../_shared/http.ts";

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  if (!isPostRequest(request)) return jsonResponse({ error: "Method not allowed." }, 405);

  try {
    const contentLength = Number(request.headers.get("content-length") || "0");
    if (contentLength > 1024) {
      return jsonResponse({ error: "Request body is too large." }, 413);
    }

    if (!await rateLimit(request, "create-inbox", 5)) {
      return jsonResponse({ error: "Too many inboxes created. Try again in a minute." }, 429);
    }

    const domain = Deno.env.get("INBOX_EMAIL_DOMAIN")?.trim().toLowerCase();
    const labels = domain?.split(".") || [];
    if (
      !domain ||
      domain.length > 253 ||
      labels.length < 2 ||
      labels.some((label) => label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) ||
      /\.(example|test|invalid|localhost)$/.test(domain)
    ) {
      return jsonResponse({ error: "A verified inbound email domain must be configured before inboxes can be created." }, 503);
    }

    if (!/^[a-z0-9.-]+$/.test(domain)) {
      return jsonResponse({ error: "Inbox email domain configuration is invalid." }, 500);
    }

    const accessToken = crypto.randomUUID() + crypto.randomUUID();
    const emailAddress = `${randomAlias()}@${domain}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const inboxes = await databaseRequest(
      "inboxes?select=id,email_address,expires_at",
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify([{
          email_address: emailAddress,
          access_token_hash: await sha256(accessToken),
          expires_at: expiresAt,
        }]),
      },
    );
    const inbox = inboxes?.[0];
    if (!inbox) throw new Error("The inbox service did not create an inbox.");

    return jsonResponse({
      inbox_id: inbox.id,
      email_address: inbox.email_address,
      expires_at: inbox.expires_at,
      access_token: accessToken,
    });
  } catch (error) {
    console.error("create-inbox failed:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Could not create an inbox." }, 500);
  }
});
