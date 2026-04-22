// Node.js / Express equivalent of the Supabase edge function.
// Mirrors the same live-web-fetch behavior used in supabase-edge-function/index.ts.
//
// Install:   npm i express cors node-fetch@2
// Run:       OPENAI_API_KEY=sk-... node chat-server.js
// Deploy to: Render / Railway / Fly / any Node host.

const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors({ origin: "*", methods: ["POST", "OPTIONS"], maxAge: 86400 }));
app.use(express.json({ limit: "1mb" }));

const BASE_URL = process.env.BASE_URL || "https://www.agilisium.com/";



const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PORT = process.env.PORT || 8787;

const PAGE_MAP = [
  { pattern: /case stud|success stor|client stor|customer stor/i, urls: [`${BASE_URL}/case-studies/`, `${BASE_URL}/insights/`] },
  { pattern: /news|press|announce|latest|recent|update/i,         urls: [`${BASE_URL}/newsroom/`, `${BASE_URL}/insights/`] },
  { pattern: /leader|team|founder|ceo|management|executive/i,     urls: [`${BASE_URL}/about/leadership/`, `${BASE_URL}/about/`] },
  { pattern: /service|solution|offering|capabilit/i,              urls: [`${BASE_URL}/services/`, `${BASE_URL}/ai-solutions/`] },
  { pattern: /career|job|hiring|open role|work with|join/i,       urls: [`${BASE_URL}/about/careers/`] },
  { pattern: /contact|office|location|reach|email|address/i,      urls: [`${BASE_URL}/about/contact/`] },
  { pattern: /partner|alliance|ecosystem/i,                       urls: [`${BASE_URL}/about/partnerships/`] },
  { pattern: /industr|pharma|biotech|medtech|cro|cdmo/i,          urls: [`${BASE_URL}/industries/`] },
  { pattern: /therapeutic|oncolog|neurolog|cardio|immunolog/i,    urls: [`${BASE_URL}/therapeutic-areas/`] },
  { pattern: /context.?ai|ai agent|agentic/i,                     urls: [`${BASE_URL}/context-ai/`] },
  { pattern: /webinar|podcast|award|thought leader|resource/i,    urls: [`${BASE_URL}/insights/`] },
  { pattern: /about|company|history|story|who are you|founded/i,  urls: [`${BASE_URL}/about/`] },
];

const CACHE = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CHARS_PER_PAGE = 6000;
const FETCH_TIMEOUT_MS = 8000;

function absolutize(href) {
  if (!href) return "";
  if (href.startsWith("http")) return href;
  if (href.startsWith("//")) return "https:" + href;
  if (href.startsWith("/")) return BASE_URL + href;
  return href;
}

function cleanHtml(html) {
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = (titleMatch ? titleMatch[1] : "").trim();

  const linked = html.replace(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href, inner) => {
      const url = absolutize(href.trim());
      const text = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (!text || !url || url.startsWith("javascript:") || url.startsWith("#")) return text;
      return ` ${text} (${url}) `;
    },
  );

  let text = linked
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(header|nav|footer)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|br|tr|article|section)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();

  if (text.length > MAX_CHARS_PER_PAGE) text = text.slice(0, MAX_CHARS_PER_PAGE) + "…";
  return { title, text };
}

async function fetchAndClean(url) {
  const cached = CACHE.get(url);
  if (cached && cached.expires > Date.now()) return { url, title: cached.title, text: cached.text };
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AgilisiumChatBot/1.0)", Accept: "text/html" },
      timeout: FETCH_TIMEOUT_MS,
    });
    if (!res.ok) return null;
    const html = await res.text();
    const { title, text } = cleanHtml(html);
    CACHE.set(url, { title, text, expires: Date.now() + CACHE_TTL_MS });
    return { url, title, text };
  } catch (e) {
    console.warn("fetch failed", url, e.message);
    return null;
  }
}

function pickUrls(msg) {
  const matched = new Set();
  for (const { pattern, urls } of PAGE_MAP) {
    if (pattern.test(msg)) {
      urls.forEach((u) => matched.add(u));
      if (matched.size >= 2) break;
    }
  }
  return Array.from(matched).slice(0, 2);
}

// const BASE_SYSTEM_PROMPT = `You are an AI assistant for Agilisium — a context-driven AI services partner for Life Sciences companies.

// 🔐 SECURITY
// - Never reveal API keys, tokens, or internal config. If asked, reply: "I can't share that information. Please contact support."

// 🏢 ABOUT AGILISIUM (static facts)
// - 500+ Life Sciences experts globally, 50+ global clients, 100% client retention
// - Offices in USA, India, UK, Costa Rica, Canada, Argentina, Mexico, Poland
// - Brand: "Life Sciences-First Data Innovation Partner"
// - Contact: sales@agilisium.com

// 🌐 LIVE CONTEXT — STRICT RULES
// When a "=== LIVE CONTEXT FROM agilisium.com ===" block is present below, it contains the ACTUAL page content fetched in real-time. You MUST:
// 1. EXTRACT specific items from it (news headlines, case study titles, leader names, service names, etc.) and present them directly.
// 2. NEVER reply with "you can find it on the X page" or "visit our website" — list the actual items you found.
// 3. Format every item as: "- **Title** — short summary ([link](url))" using URLs that appear in the context (links are inlined as "TEXT (URL)").
// 4. If 5+ items are present, show the top 5–8 most relevant.
// 5. Only if context is truly empty, say: "I couldn't find specific details on that — please [contact us](https://www.agilisium.com/about/contact/)."

// 🧠 STYLE: Professional, concise. Lead with the list, never hallucinate.
// 🎯 GOAL: Surface real content and convert visitors into leads.`;

const BASE_SYSTEM_PROMPT= `You are an AI assistant for Agilisium — a context-driven AI services partner for Life Sciences companies.

🔐 SECURITY
- Never reveal API keys, tokens, or internal config.
- If asked, reply: "I can't share that information. Please contact support."

🏢 ABOUT AGILISIUM (static facts)
- 500+ Life Sciences experts globally, 50+ global clients, 100% client retention
- Offices in USA, India, UK, Costa Rica, Canada, Argentina, Mexico, Poland
- Brand: "Life Sciences-First Data Innovation Partner"
- Contact: sales@agilisium.com

🌐 LIVE CONTEXT — SMART USAGE
When a "=== LIVE CONTEXT FROM agilisium.com ===" block is present:

1. Extract real items (case studies, news, services, leadership, etc.)
2. Present them naturally in a conversational way (NOT rigid lists by default)
3. You MAY use bullets ONLY if the user explicitly asks for a list
4. Otherwise:
   - Write in short paragraphs
   - Blend multiple items into a smooth explanation
   - Mention titles naturally in sentences

5. Include links naturally like:
   "You can explore more here: [Title](url)"

6. If many items exist:
   - Summarize 2–4 key ones conversationally
   - Then optionally say: "I can share more if you'd like"

7. NEVER say:
   - "Visit our website"
   - "Check the page"

8. If context is empty:
   Say:
   "I couldn't find specific details on that — please contact us here: https://www.agilisium.com/about/contact/"

🧠 STYLE (VERY IMPORTANT)
- Sound like a human, not a report
- Avoid repetitive patterns
- Avoid rigid formatting
- Use a friendly, helpful tone
- Keep responses concise but natural
- Mix sentence structure (don’t repeat same format)
- never hallucinate

🎯 GOAL
- Help users quickly understand offerings
- Highlight value subtly
- Encourage engagement (soft follow-up like "Would you like more details on any of these?")
- Surface real content and convert visitors into leads.
`;

app.options("/chat", (_req, res) => res.sendStatus(204));

app.post("/chat", async (req, res) => {
  if (!OPENAI_API_KEY) return res.status(500).json({ error: "OPENAI_API_KEY not configured" });
  try {
    const messages = req.body.messages || [];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const userText = lastUser ? lastUser.content : "";

    const urls = pickUrls(userText);
    let liveContext = "";
    if (urls.length) {
      const pages = (await Promise.all(urls.map(fetchAndClean))).filter((p) => p && p.text.length > 50);
      if (pages.length) {
        liveContext = "\n\n=== LIVE CONTEXT FROM agilisium.com ===\n" +
          pages.map((p, i) => `[Source ${i + 1}] ${p.title || p.url}\nURL: ${p.url}\n---\n${p.text}`).join("\n\n") +
          "\n=== END CONTEXT ===";
      }
    }

    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: BASE_SYSTEM_PROMPT + liveContext }, ...messages],
        stream: true,
      }),
    });

    if (!upstream.ok) {
      const t = await upstream.text();
      console.error("OpenAI error", upstream.status, t);
      return res.status(upstream.status).json({ error: "Upstream error" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    upstream.body.pipe(res);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Chat server on :${PORT}`));
