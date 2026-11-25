import { corsHeaders, databaseRequest, isPostRequest, jsonResponse, rateLimit, readJsonBody, sha256 } from "../_shared/http.ts";

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  if (!isPostRequest(request)) return jsonResponse({ error: "Method not allowed." }, 405);

  try {
    if (!await rateLimit(request, "inbox-api-ip", 60)) {
      return jsonResponse({ error: "Too many inbox requests. Try again in a minute." }, 429);
    }

    const parsedBody = await readJsonBody(request, 4096);
    if (!parsedBody.ok) return jsonResponse({ error: parsedBody.error }, parsedBody.status);
    const body = parsedBody.value;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonResponse({ error: "Request body must be a JSON object." }, 400);
    }
    const inboxId = body?.inbox_id;
    const accessToken = body?.access_token;
    if (
      typeof inboxId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(inboxId) ||
      typeof accessToken !== "string" ||
      accessToken.length < 32 ||
      accessToken.length > 128
    ) {
      return jsonResponse({ error: "Inbox credentials are invalid." }, 400);
    }

    const tokenHash = await sha256(accessToken);
    const inboxes = await databaseRequest(
      `inboxes?id=eq.${encodeURIComponent(inboxId)}&access_token_hash=eq.${tokenHash}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=id`,
    );
    if (!inboxes?.length) {
      return jsonResponse({ error: "This inbox has expired or its credentials are invalid." }, 404);
    }

    if (!await rateLimit(request, `inbox:${inboxId}`, 120, 60, false)) {
      return jsonResponse({ error: "This inbox is being accessed too frequently. Try again in a minute." }, 429);
    }

    if (body.message_id !== undefined) {
      if (
        typeof body.message_id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.message_id)
      ) {
        return jsonResponse({ error: "Message ID is invalid." }, 400);
      }
      const messages = await databaseRequest(
        `messages?id=eq.${encodeURIComponent(body.message_id)}&inbox_id=eq.${encodeURIComponent(inboxId)}&select=id,sender,subject,text_body,received_at&limit=1`,
      );
      if (!messages?.length) return jsonResponse({ error: "Message not found." }, 404);
      return jsonResponse({ message: messages[0] });
    }

    const messages = await databaseRequest(
      `messages?inbox_id=eq.${encodeURIComponent(inboxId)}&select=id,sender,subject,received_at&order=received_at.desc&limit=50`,
    );
    return jsonResponse({ messages: messages || [] });
  } catch (error) {
    console.error("inbox-api failed:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Could not access the inbox." }, 500);
  }
});
