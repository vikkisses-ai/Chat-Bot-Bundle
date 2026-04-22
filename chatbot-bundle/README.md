# Agilisium Chatbot — Embed Bundle

A drop-in AI chat widget that pulls **live content from agilisium.com** on every query and replies with real titles + clickable links.

## What's inside

```
chatbot-bundle/
├── frontend/
│   ├── ChatWidget.tsx              React version (used in this app)
│   └── vanilla-js/                 Drop-in for WordPress / any HTML site
│       ├── chatbot.js              Self-contained, no deps, no build
│       ├── chatbot.css             Namespaced under .agx-* — won't collide
│       ├── embed-snippet.html      1-line install snippet
│       └── demo.html               Standalone test page
├── backend/
│   ├── supabase-edge-function/     Deno edge function (deployed today)
│   ├── nodejs-express/             Equivalent Node.js server
│   └── DEPLOYMENT.md               Full deploy + CORS guide
└── README.md                       (this file)
```

## Quick start (WordPress)

1. Deploy the backend → see [DEPLOYMENT.md](backend/DEPLOYMENT.md)
2. Host `frontend/vanilla-js/chatbot.js` + `chatbot.css` on any public URL
3. Paste this in your WordPress footer:

   ```html
   <script src="https://your-cdn.com/chatbot.js"
           data-endpoint="https://your-backend/chat"
           data-title="Agilisium AI"
           data-accent="#0a1628"></script>
   ```

4. Done. Test with `frontend/vanilla-js/demo.html` first.

## How the live web context works

Every user message is matched against keyword regex (case studies, news, leadership, services, careers, etc.). Matching pages on agilisium.com are fetched server-side, HTML→text cleaned, links preserved, and injected into the system prompt. OpenAI then replies citing real content with real URLs — never "visit our website."

10-min in-memory cache keeps repeat queries fast.

## Customizing for a different site

Edit `BASE_URL` and `PAGE_MAP` in `backend/supabase-edge-function/index.ts`. Edit `BASE_SYSTEM_PROMPT` for brand voice. Redeploy.
