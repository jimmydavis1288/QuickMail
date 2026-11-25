import { constantTimeEquals, corsHeaders, databaseRequest, isPostRequest, jsonResponse, readJsonBody } from "../_shared/http.ts";

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  if (!isPostRequest(request)) return jsonResponse({ error: "Method not allowed." }, 405);

  const secret = Deno.env.get("INBOUND_WEBHOOK_SECRET");
  if (!secret) return jsonResponse({ error: "Inbound email reception is not configured." }, 503);
  const authorization = request.headers.get("Authorization") || "";
  if (!constantTimeEquals(authorization, `Bearer ${secret}`)) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  try {
    const parsedBody = await readJsonBody(request, 512 * 1024);
    if (!parsedBody.ok) return jsonResponse({ error: parsedBody.error }, parsedBody.status);
    const body = parsedBody.value;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonResponse({ error: "Request body must be a JSON object." }, 400);
    }
    const recipient = typeof body?.recipient === "string" ? body.recipient.trim().toLowerCase() : "";
    const sender = typeof body?.sender === "string" ? body.sender.trim() : "";
    const subject = typeof body?.subject === "string" ? body.subject.trim() : "";
    const textBody = typeof body?.text_body === "string" ? body.text_body : "";
    if (
      recipient.length > 254 ||
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient) ||
      !sender ||
      sender.length > 320 ||
      subject.length > 998 ||
      textBody.length > 100_000
    ) {
      return jsonResponse({ error: "Email payload is invalid." }, 400);
    }

    const inboxes = await databaseRequest(
      `inboxes?email_address=eq.${encodeURIComponent(recipient)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=id&limit=1`,
    );
    if (!inboxes?.length) return jsonResponse({ error: "Active recipient inbox not found." }, 404);

    await databaseRequest("messages", {
      method: "POST",
      body: JSON.stringify([{
        inbox_id: inboxes[0].id,
        sender,
        subject,
        text_body: textBody,
      }]),
    });
    return jsonResponse({ accepted: true }, 202);
  } catch (error) {
    console.error("inbound-webhook failed:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Could not accept this email." }, 500);
  }
});
