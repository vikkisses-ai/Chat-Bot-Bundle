import { useState, useRef, useEffect, Suspense, useCallback } from "react";
import { Send, Minus, Maximize2, Minimize2, X, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AI3DOrb } from "./AI3DOrb";
import { useIsMobile } from "@/hooks/use-mobile";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Message = { role: "user" | "assistant"; content: string };
type ViewState = "minimized" | "expanded" | "fullscreen";

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
const STORAGE_KEY = "agilisium_chat_history";
const AUTO_EXPAND_KEY = "agilisium_chat_auto_expanded";
const INACTIVITY_MS = 60_000;
const AUTO_EXPAND_MS = 5_000;

const quickActions = [
  { label: "Explore Solutions", action: "What AI solutions does Agilisium offer?" },
  { label: "Browse Insights", action: "Tell me about Agilisium's thought leadership and insights" },
  { label: "View Case Studies", action: "Can you share some case studies or success stories?" },
  { label: "Read Latest News", action: "What's the latest news from Agilisium?" },
  { label: "Explore Careers", action: "What career opportunities are available at Agilisium?" },
  { label: "Connect with an Expert", action: "I'd like to speak with an expert about my project", highlighted: true },
];

const followUpChips = ["Tell me more", "Show case studies", "Book a consultation"];

async function streamChat({
  messages,
  onDelta,
  onDone,
  onError,
}: {
  messages: Message[];
  onDelta: (deltaText: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}) {
  try {
    const resp = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({ messages }),
    });

    if (!resp.ok) {
      const errorData = await resp.json().catch(() => ({}));
      onError(errorData.error || "Failed to get response");
      return;
    }
    if (!resp.body) {
      onError("No response body");
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let textBuffer = "";
    let streamDone = false;

    while (!streamDone) {
      const { done, value } = await reader.read();
      if (done) break;
      textBuffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
        let line = textBuffer.slice(0, newlineIndex);
        textBuffer = textBuffer.slice(newlineIndex + 1);

        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.startsWith(":") || line.trim() === "") continue;
        if (!line.startsWith("data: ")) continue;

        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") {
          streamDone = true;
          break;
        }
        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content as string | undefined;
          if (content) onDelta(content);
        } catch {
          textBuffer = line + "\n" + textBuffer;
          break;
        }
      }
    }
    onDone();
  } catch (error) {
    console.error("Stream error:", error);
    onError("Connection error. Please try again.");
  }
}

export function ChatWidget() {
  const isMobile = useIsMobile();
  const [view, setView] = useState<ViewState>(() => {
    if (typeof window === "undefined") return "minimized";
    return sessionStorage.getItem(AUTO_EXPAND_KEY) ? "minimized" : "expanded";
  });
  const [messages, setMessages] = useState<Message[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Message[]) : [];
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState("");
  const [pillInput, setPillInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const inactivityTimer = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const touchDeltaY = useRef(0);
  const [dragOffset, setDragOffset] = useState(0);

  // Persist messages
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      /* ignore */
    }
  }, [messages]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, view]);

  // Auto-expand on first visit (handled in initial state); mark flag
  useEffect(() => {
    if (!sessionStorage.getItem(AUTO_EXPAND_KEY)) {
      sessionStorage.setItem(AUTO_EXPAND_KEY, "1");
    }
  }, []);

  // Inactivity auto-minimize
  const resetInactivity = useCallback(() => {
    if (inactivityTimer.current) window.clearTimeout(inactivityTimer.current);
    if (view === "minimized" || isLoading) return;
    inactivityTimer.current = window.setTimeout(() => {
      setView("minimized");
    }, INACTIVITY_MS);
  }, [view, isLoading]);

  useEffect(() => {
    resetInactivity();
    return () => {
      if (inactivityTimer.current) window.clearTimeout(inactivityTimer.current);
    };
  }, [resetInactivity, messages]);

  // Click outside (expanded only, desktop only)
  useEffect(() => {
    if (view !== "expanded" || isMobile) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (pillRef.current?.contains(t)) return;
      setView("minimized");
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [view, isMobile]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;
    const userMsg: Message = { role: "user", content: text.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);
    setError(null);

    let assistantContent = "";
    const updateAssistant = (chunk: string) => {
      assistantContent += chunk;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantContent } : m));
        }
        return [...prev, { role: "assistant", content: assistantContent }];
      });
    };

    await streamChat({
      messages: [...messages, userMsg],
      onDelta: updateAssistant,
      onDone: () => setIsLoading(false),
      onError: (err) => {
        setError(err);
        setIsLoading(false);
      },
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handlePillSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = pillInput.trim();
    setPillInput("");
    setView("expanded");
    if (text) setTimeout(() => sendMessage(text), 50);
  };

  const clearChat = () => {
    setMessages([]);
    setError(null);
  };

  // Mobile swipe-down
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    touchDeltaY.current = 0;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current == null) return;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (dy > 0) {
      touchDeltaY.current = dy;
      setDragOffset(dy);
    }
  };
  const onTouchEnd = () => {
    if (touchDeltaY.current > 80) {
      setView("minimized");
    }
    setDragOffset(0);
    touchStartY.current = null;
    touchDeltaY.current = 0;
  };

  const showFollowUps =
    messages.length >= 2 &&
    messages[messages.length - 1]?.role === "assistant" &&
    !isLoading;

  // ---------- Panel (shared content for expanded + fullscreen) ----------
  const renderHeader = () => (
    <div className="bg-gradient-to-r from-primary via-secondary to-accent p-4 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur flex items-center justify-center overflow-hidden">
          <Suspense fallback={<span className="text-white font-bold">AI</span>}>
            <AI3DOrb />
          </Suspense>
        </div>
        <div>
          <h3 className="font-semibold text-white leading-tight">AI Assistant</h3>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            <span className="text-xs text-white/80">Online</span>
            {messages.length > 0 && (
              <button
                onClick={clearChat}
                className="ml-2 text-xs text-white/70 hover:text-white inline-flex items-center gap-1"
                aria-label="Clear chat"
              >
                <Trash2 className="w-3 h-3" /> Clear
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => setView("minimized")}
          className="text-white/80 hover:text-white p-2 transition-colors"
          aria-label="Minimize"
        >
          <Minus className="w-5 h-5" />
        </button>
        {view === "fullscreen" ? (
          <button
            onClick={() => setView("expanded")}
            className="text-white/80 hover:text-white p-2 transition-colors"
            aria-label="Collapse"
          >
            <Minimize2 className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={() => setView("fullscreen")}
            className="text-white/80 hover:text-white p-2 transition-colors"
            aria-label="Fullscreen"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        )}
        {isMobile && (
          <button
            onClick={() => setView("minimized")}
            className="text-white/80 hover:text-white p-2 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );

  const renderBody = () => (
    <div className="flex-1 overflow-y-auto p-4 bg-muted/30">
      {messages.length === 0 && (
        <div className="space-y-4">
          <div>
            <h4 className="font-semibold text-foreground mb-1">Hello, how can I help you today?</h4>
            <p className="text-sm text-muted-foreground">You may type your question or choose from the options below:</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {quickActions.map((qa) => (
              <button
                key={qa.label}
                onClick={() => sendMessage(qa.action)}
                className={cn(
                  "text-left px-4 py-3 rounded-lg border transition-all text-sm",
                  qa.highlighted
                    ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
                    : "bg-white border-border text-foreground hover:border-primary hover:bg-primary/5"
                )}
              >
                {qa.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {messages.map((msg, i) => (
        <div
          key={i}
          className={cn("mb-4 flex", msg.role === "user" ? "justify-end" : "justify-start")}
        >
          <div
            className={cn(
              "max-w-[85%] rounded-2xl px-4 py-3 text-sm",
              msg.role === "user"
                ? "bg-primary text-primary-foreground rounded-br-md"
                : "bg-white border border-border text-foreground rounded-bl-md shadow-sm"
            )}
          >
            {msg.role === "assistant" ? (
              <div className="prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-a:text-primary leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content || "…"}</ReactMarkdown>
              </div>
            ) : (
              <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
            )}
          </div>
        </div>
      ))}

      {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
        <div className="flex justify-start mb-4">
          <div className="bg-white border border-border rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
            <div className="text-xs text-muted-foreground mb-1">AI is typing…</div>
            <div className="flex gap-1.5">
              <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="text-center text-destructive text-xs py-2 bg-destructive/10 rounded-lg">{error}</div>
      )}
      <div ref={messagesEndRef} />
    </div>
  );

  const renderInput = () => (
    <div className="p-4 bg-card border-t border-border shrink-0">
      {showFollowUps && (
        <div className="flex flex-wrap gap-2 mb-3">
          {followUpChips.map((c) => (
            <button
              key={c}
              onClick={() => sendMessage(c)}
              className="text-xs px-3 py-1.5 rounded-full border border-border bg-background hover:bg-primary/5 hover:border-primary text-foreground transition-colors"
            >
              {c}
            </button>
          ))}
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            resetInactivity();
          }}
          placeholder="Type your message..."
          className="flex-1 px-4 py-3 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          disabled={isLoading}
        />
        <Button
          type="submit"
          size="icon"
          className="rounded-xl h-11 w-11 bg-primary hover:bg-primary/90"
          disabled={!input.trim() || isLoading}
        >
          <Send className="w-5 h-5" />
        </Button>
      </form>
    </div>
  );

  // ---------- Layout containers ----------
  const expandedDesktop = (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 animate-in fade-in duration-300" onClick={() => setView("minimized")} />
      <div
        ref={panelRef}
        className={cn(
          "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[420px] h-[600px] max-w-[calc(100vw-3rem)] max-h-[calc(100vh-3rem)] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col",
          "animate-in fade-in zoom-in-95 duration-300"
        )}
        onClick={(e) => { e.stopPropagation(); resetInactivity(); }}
      >
        {renderHeader()}
        {renderBody()}
        {renderInput()}
      </div>
    </>
  );

  const expandedMobile = (
    <div
      ref={panelRef}
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl shadow-2xl overflow-hidden flex flex-col",
        "animate-in slide-in-from-bottom-8 fade-in duration-300"
      )}
      style={{
        height: "85vh",
        transform: `translateY(${dragOffset}px)`,
        transition: dragOffset === 0 ? "transform 0.2s ease-out" : "none",
      }}
      onClick={resetInactivity}
    >
      <div
        className="flex justify-center py-2 cursor-grab touch-none bg-white"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className="w-10 h-1.5 rounded-full bg-muted-foreground/30" />
      </div>
      {renderHeader()}
      {renderBody()}
      {renderInput()}
    </div>
  );

  const fullscreenPanel = (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 animate-in fade-in duration-300" onClick={() => setView("expanded")} />
      <div
        ref={panelRef}
        className={cn(
          "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white shadow-2xl overflow-hidden flex flex-col rounded-2xl",
          "animate-in fade-in zoom-in-95 duration-300",
          isMobile ? "w-screen h-screen rounded-none" : "w-[70vw] max-w-[900px] h-[85vh] max-h-[800px]"
        )}
        onClick={(e) => { e.stopPropagation(); resetInactivity(); }}
      >
        {renderHeader()}
        {renderBody()}
        {renderInput()}
      </div>
    </>
  );

  return (
    <>
      {view === "expanded" && (isMobile ? expandedMobile : expandedDesktop)}
      {view === "fullscreen" && fullscreenPanel}

      {/* Persistent collapsed pill (always visible) */}
      <div ref={pillRef} className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 transition-all duration-300">
        <div className="flex items-center gap-2 bg-gradient-to-r from-primary via-secondary to-accent rounded-full pl-4 pr-2 py-2 shadow-2xl">
          <button
            onClick={() => setView("expanded")}
            className="text-white font-bold text-lg select-none"
            aria-label="Open chat"
          >
            AI
          </button>
          <form onSubmit={handlePillSubmit} className="flex items-center gap-2">
            <input
              type="text"
              value={pillInput}
              onChange={(e) => setPillInput(e.target.value)}
              onFocus={() => view === "minimized" && setView("expanded")}
              placeholder="Ask AI..."
              className="bg-white rounded-full px-4 py-2 text-sm text-foreground w-[220px] max-w-[50vw] focus:outline-none focus:ring-2 focus:ring-white/50"
            />
            <Button
              type="submit"
              size="icon"
              className="rounded-full bg-primary hover:bg-primary/90 h-9 w-9"
            >
              <Send className="w-4 h-4" />
            </Button>
          </form>
          <button
            onClick={() => setView(view === "minimized" ? "expanded" : "minimized")}
            className="text-white/90 hover:text-white p-1.5 transition-colors"
            aria-label={view === "minimized" ? "Expand chat" : "Minimize chat"}
          >
            {view === "minimized" ? <Maximize2 className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </>
  );
}
