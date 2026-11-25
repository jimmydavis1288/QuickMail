# QuickMail

A React + Vite temporary-inbox MVP. Inbox creation, message access, and inbound-email insertion run through Supabase Edge Functions. The browser only receives the Supabase public anon key and a random, per-inbox access token. **No real messages can arrive until you connect an inbound email provider and configure its webhook.**

## Run locally

1. Install Node.js 20+ and the [Supabase CLI](https://supabase.com/docs/guides/cli).
2. Create a Supabase project and copy `.env.example` to `.env.local`.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local`.
4. Install and start the frontend:

   ```sh
   npm install
   npm run dev
   ```

Without these public frontend settings, the app explains how to configure Supabase instead of creating a fake inbox.

## Configure Supabase

From the project directory, authenticate and link your project:

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

The existing migration creates inbox and message tables, denies direct client access with RLS/grants, and schedules deletion of expired inboxes every five minutes using `pg_cron`. The rate-limit migration adds atomic database-backed per-IP and per-inbox limits; it is cleaned up hourly. A service-role grants migration permits only the server functions to select/insert inbox/message rows. Client roles remain denied by RLS and table grants.

Supabase automatically provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. Do not copy either key into frontend variables. Set a real verified inbound domain only after configuring its MX/inbound routing. CORS is fail-closed unless `ALLOWED_ORIGIN` is set:

```sh
supabase secrets set INBOX_EMAIL_DOMAIN=YOUR_INBOUND_DOMAIN
supabase secrets set ALLOWED_ORIGIN=https://YOUR_SITE.vercel.app
```

Generate a webhook secret with Node.js, then set the printed value:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
supabase secrets set INBOUND_WEBHOOK_SECRET=PASTE_GENERATED_VALUE
```

Deploy the server functions:

```sh
supabase functions deploy create-inbox --no-verify-jwt
supabase functions deploy inbox-api --no-verify-jwt
supabase functions deploy inbound-webhook --no-verify-jwt
```

The functions intentionally do not rely on Supabase Auth JWTs: inbox authorization uses a high-entropy secret returned once at creation. Its SHA-256 hash is stored server-side; each read checks both this token and that the inbox has not expired. Keep the token in the browser's local storage private. Anyone who obtains it can read that inbox until it expires. Creation is limited to five requests per minute per IP; inbox reads are limited per IP and per inbox. A verified inbound email domain is required before inbox creation is enabled; QuickMail never issues a placeholder email address.

## Connect inbound email (optional)

Until a provider is configured, QuickMail clearly marks reception as disconnected; it does not simulate delivery. Configure MX/inbound routing for your verified domain at an email provider, then point its authenticated webhook to:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/inbound-webhook
```

Configure the provider to send `Authorization: Bearer <INBOUND_WEBHOOK_SECRET>` and a JSON payload:

```json
{
  "recipient": "the-generated-address@your-inbound-domain.example",
  "sender": "sender@example.org",
  "subject": "Hello",
  "text_body": "Plain-text message body"
}
```

The webhook rejects unauthenticated/invalid requests and only stores mail for an active inbox. Map the provider's verified event format to this payload using a small server-side adapter if necessary. Only plain-text bodies are stored/rendered.

## Deploy to Vercel

1. Push this project to your Git provider and import it in Vercel (or run `vercel`).
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Vercel project environment variables for Preview and Production.
3. Set Supabase Edge Function secrets as above; use your real Vercel origin for `ALLOWED_ORIGIN`.
4. Deploy the Vercel project. When changing Vite environment variables, trigger a new build/deployment.

`SUPABASE_SERVICE_ROLE_KEY` and `INBOUND_WEBHOOK_SECRET` belong only in Supabase Function secrets, never in Vercel frontend variables, source control, or `.env` files.
