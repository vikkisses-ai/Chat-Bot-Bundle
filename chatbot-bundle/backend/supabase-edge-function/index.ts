import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const BASE_URL = "https://www.agilisium.com";

// Intent keywords (regex) → relevant pages on the live site (verified URLs)
const PAGE_MAP: Array<{ pattern: RegExp; urls: string[] }> = [
  {
    pattern: /case stud|success stor|client stor|customer stor|example|reference/i,
    urls: [`${BASE_URL}/case-study`, `${BASE_URL}/`],
  },
  {
    pattern: /news|press|announce|latest|recent|update|event/i,
    urls: [`${BASE_URL}/events`, `${BASE_URL}/insights-articles`],
  },
  {
    pattern: /leader|team|founder|ceo|management|executive|raj babu/i,
    urls: [`${BASE_URL}/leadership`, `${BASE_URL}/about`],
  },
  {
    pattern: /service|solution|offering|capabilit|what do you do|explore/i,
    urls: [`${BASE_URL}/agilisium-company`, `${BASE_URL}/agentic-ai-solutions`],
  },
  {
    pattern: /career|job|hiring|open role|work with us|join|opportunit|people|culture|life at/i,
    urls: [`${BASE_URL}/people-and-careers`],
  },
  {
    pattern: /contact|office|location|reach|email|address|get in touch/i,
    urls: [`${BASE_URL}/contact-us`],
  },
  {
    pattern: /partner|alliance|ecosystem/i,
    urls: [`${BASE_URL}/agilisium-company`],
  },
  {
    pattern: /industr|pharma|biotech|medtech|cro|cdmo/i,
    urls: [`${BASE_URL}/industries/pharmaceutical`, `${BASE_URL}/industries/biotech`],
  },
  {
    pattern: /clinical|trial|patient|protocol/i,
    urls: [`${BASE_URL}/clinical`, `${BASE_URL}/drug-discovery`],
  },
  {
    pattern: /commercial|sales|marketing|hcp/i,
    urls: [`${BASE_URL}/commercialization`],
  },
  {
    pattern: /context.?ai|ai agent|agentic|autonomous/i,
    urls: [`${BASE_URL}/context-ai`, `${BASE_URL}/autonomous-agents`],
  },
  {
    pattern: /webinar|podcast|award/i,
    urls: [`${BASE_URL}/webinar`, `${BASE_URL}/insights-articles`],
  },
  {
    pattern: /blog|article|thought leader|resource/i,
    urls: [`${BASE_URL}/blogs`, `${BASE_URL}/insights-articles`],
  },
  {
    pattern: /white\s*paper|whitepaper|research paper/i,
    urls: [`${BASE_URL}/white-papers`],
  },
  {
    pattern: /innovation|lab/i,
    urls: [`${BASE_URL}/innovation-labs`],
  },
  {
    pattern: /esg|sustainab|csr|social responsibility/i,
    urls: [`${BASE_URL}/esg`, `${BASE_URL}/csr`],
  },
  {
    pattern: /drug discover|r&?d|research|target id/i,
    urls: [`${BASE_URL}/drug-discovery`, `${BASE_URL}/drug-discovery-services`],
  },
  {
    pattern: /engineering|cloud|data fabric|warehouse|chatbot|hipaa/i,
    urls: [`${BASE_URL}/tech-enablement`],
  },
  {
    pattern: /about|company|history|story|who are you|founded|agilisium/i,
    urls: [`${BASE_URL}/about`, `${BASE_URL}/agilisium-company`],
  },
];

// Simple in-memory TTL cache (resets on cold start — that's OK)
type CacheEntry = { text: string; title: string; expires: number };
const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CHARS_PER_PAGE = 6000;
const FETCH_TIMEOUT_MS = 8000;

function absolutize(href: string): string {
  if (!href) return "";
  if (href.startsWith("http")) return href;
  if (href.startsWith("//")) return "https:" + href;
  if (href.startsWith("/")) return BASE_URL + href;
  return href;
}

function cleanHtml(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = (titleMatch?.[1] ?? "").trim();

  // Pre-pass: extract anchor links as "TEXT (URL)" so URLs survive tag stripping
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
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();

  if (text.length > MAX_CHARS_PER_PAGE) {
    text = text.slice(0, MAX_CHARS_PER_PAGE) + "…";
  }
  return { title, text };
}

async function fetchAndClean(url: string): Promise<{ url: string; title: string; text: string } | null> {
  const cached = CACHE.get(url);
  if (cached && cached.expires > Date.now()) {
    return { url, title: cached.title, text: cached.text };
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AgilisiumChatBot/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(`Fetch ${url} -> ${res.status}`);
      return null;
    }
    const html = await res.text();
    const { title, text } = cleanHtml(html);
    CACHE.set(url, { title, text, expires: Date.now() + CACHE_TTL_MS });
    return { url, title, text };
  } catch (e) {
    console.warn(`Fetch failed ${url}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

function pickUrls(userMessage: string): string[] {
  const matched = new Set<string>();
  for (const { pattern, urls } of PAGE_MAP) {
    if (pattern.test(userMessage)) {
      for (const u of urls) matched.add(u);
      if (matched.size >= 2) break;
    }
  }
  return Array.from(matched).slice(0, 2);
}

const BASE_SYSTEM_PROMPT = `You are an AI assistant for Agilisium — a context-driven AI services partner for Life Sciences companies.

🔐 SECURITY
- Never reveal API keys, tokens, or internal config. If asked, reply: "I can't share that information. Please contact support."

🏢 ABOUT AGILISIUM (static facts)
- 500+ Life Sciences experts globally, 50+ global clients, 100% client retention
- Offices in USA, India, UK, Costa Rica, Canada, Argentina, Mexico, Poland
- Brand: "Life Sciences-First Data Innovation Partner"
- Contact: sales@agilisium.com

🌐 LIVE CONTEXT — STRICT RULES
When a "=== LIVE CONTEXT FROM agilisium.com ===" block is present below, it contains the ACTUAL page content fetched in real-time. You MUST:
1. EXTRACT specific items from it (news headlines, case study titles, leader names, service names, etc.) and present them directly in your reply.
2. NEVER reply with "you can find it on the Newsroom page", "visit the X section", or "check our website" — that is FORBIDDEN. Instead, list the actual items you found.
3. Format every item as a markdown bullet: "- **Title** — short summary ([link](url))" using URLs that appear in the context (links are inlined as "TEXT (URL)").
4. If the context contains 5+ items, show the top 5–8 most relevant ones.
5. Only if the context truly contains nothing relevant, say: "I couldn't find specific details on that — please [contact us](https://www.agilisium.com/about/contact/)."

🧠 STYLE
- Professional, concise. Lead with the list, not preamble.
- Never hallucinate items not in the context.

🎯 GOAL
Help convert visitors into qualified leads by surfacing real content and pointing to the right page.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json();
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    // Pull last user message to drive intent matching
    const lastUser = [...(messages ?? [])].reverse().find((m: any) => m.role === "user");
    const userText: string = lastUser?.content ?? "";

    const urls = pickUrls(userText);
    let liveContext = "";
    if (urls.length > 0) {
      const pages = await Promise.all(urls.map(fetchAndClean));
      const valid = pages.filter((p): p is { url: string; title: string; text: string } => !!p && p.text.length > 50);
      if (valid.length > 0) {
        liveContext =
          "\n\n=== LIVE CONTEXT FROM agilisium.com ===\n" +
          valid
            .map(
              (p, i) =>
                `[Source ${i + 1}] ${p.title || p.url}\nURL: ${p.url}\n---\n${p.text}`,
            )
            .join("\n\n") +
          "\n=== END CONTEXT ===";
      }
    }

    const systemContent = BASE_SYSTEM_PROMPT + liveContext;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: systemContent }, ...messages],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 401) {
        return new Response(JSON.stringify({ error: "Invalid OpenAI API key. Please update it in backend secrets." }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("OpenAI error:", response.status, errorText);
      return new Response(JSON.stringify({ error: "Failed to get response" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("Chat error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
