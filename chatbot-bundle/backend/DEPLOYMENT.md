# Agilisium Chatbot — Deployment Guide

## 1. Deploy the backend

### Option A — Supabase Edge Function (recommended, what's running today)

```bash
# from your supabase project root
cp -r backend/supabase-edge-function supabase/functions/chat
supabase secrets set OPENAI_API_KEY=sk-...
supabase functions deploy chat --no-verify-jwt
```

Endpoint becomes: `https://<project-ref>.supabase.co/functions/v1/chat`

### Option B — Node.js / Express (any Node host)

```bash
cd backend/nodejs-express
npm i express cors node-fetch@2
OPENAI_API_KEY=sk-... node chat-server.js
```

Deploy to Render / Railway / Fly. Endpoint becomes `https://your-host/chat`.

## 2. Install on WordPress (or any HTML site)

1. Host `frontend/vanilla-js/chatbot.js` and `chatbot.css` somewhere public (your own server, GitHub Pages, jsDelivr, S3 — anything served with CORS).
2. In WordPress, install the "Insert Headers and Footers" plugin (or edit `header.php`).
3. Paste the snippet from `frontend/vanilla-js/embed-snippet.html`, replacing `data-endpoint` with your backend URL from step 1.
4. Save. The chat pill will appear bottom-right on every page.

## 3. CORS / origin lockdown (production hardening)

The backend currently allows `Access-Control-Allow-Origin: *`. For production lock it to your domain:

```ts
// supabase-edge-function/index.ts
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://www.agilisium.com",
  ...
};
```

Redeploy after editing.

## 4. Swap the system prompt for a different brand

Edit `BASE_SYSTEM_PROMPT` and `BASE_URL` in `backend/supabase-edge-function/index.ts` (or `chat-server.js`). Update the `PAGE_MAP` regex → URL list to match your site's real page paths. Redeploy.

## 5. Troubleshooting

- **Bot says "visit our website"** → system prompt is being ignored. Confirm you deployed the latest `index.ts` from this bundle.
- **404 from edge function** → run `supabase functions deploy chat` again.
- **CORS error in browser console** → add your origin to `Access-Control-Allow-Origin` and redeploy.
- **Bot replies are generic / no real content** → check edge function logs for `Fetch ... -> 404`. Means a URL in `PAGE_MAP` is wrong; fix it.
