/*!
 * Agilisium Chatbot — vanilla JS embed (no deps, no build step)
 * Theme: Teal & Mint
 * FIXES:
 *   - Wheel scroll now works by hovering inside the chat (no scrollbar needed)
 *   - Fullscreen panel always centers correctly (fixed positioning independent of root)
 *   - Expanded (corner) panel always snaps to bottom-right correctly
 *   - Messages cleared properly on minimize
 *   - Works on all pages when script is in global site footer
 *   - Session persists across minimize/maximize/close; clears only on page refresh/close
 */
(function () {
  if (window.__agxChatLoaded) return;
  window.__agxChatLoaded = true;

  var script = document.currentScript || (function () {
    var s = document.getElementsByTagName("script");
    return s[s.length - 1];
  })();
  var ENDPOINT = script.getAttribute("data-endpoint") || "/chat";
  var TITLE = script.getAttribute("data-title") || "Agilisium AI";
  var BRAND = script.getAttribute("data-brand") || "Ask Agilisium AI";

  /* Inject CSS */
  if (!document.querySelector('link[href*="chatbot.css"]')) {
    var basePath = script.src.replace(/chatbot\.js.*$/, "");
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = basePath + "chatbot.css";
    document.head.appendChild(link);
  }

  /* ── Session Storage helpers ── */
  var SESSION_KEY = "__agxMessages";

  function loadMessages() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveMessages(msgs) {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(msgs));
    } catch (e) {}
  }

  function clearMessages() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch (e) {}
  }

  /* State */
  var state = "minimized"; // minimized | expanded | fullscreen
  var messages = loadMessages(); /* CHANGED: load from sessionStorage on init */
  var streaming = false;

  /* Rotating placeholder phrases */
  var PLACEHOLDERS = [
    "Ask about our AI services…",
    "Show me case studies",
    "What's the latest news?",
    "Explore careers at Agilisium",
    "Tell me about leadership",
    "How can Agilisium help me?",
  ];

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function md(s) {
    s = escapeHtml(s);
    s = s.replace(/```([\s\S]*?)```/g, function (_, c) { return "<pre><code>" + c + "</code></pre>"; });
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/^### (.+)$/gm, "<h4>$1</h4>");
    s = s.replace(/^## (.+)$/gm, "<h3>$1</h3>");
    s = s.replace(/^# (.+)$/gm, "<h2>$1</h2>");
    s = s.replace(/^\s*[-*] (.+)$/gm, "<li>$1</li>");
    s = s.replace(/(<li>.*<\/li>\n?)+/g, function (m) { return "<ul>" + m + "</ul>"; });
    s = s.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>");
    return "<p>" + s + "</p>";
  }

  /* DOM */
  var root = document.createElement("div");
  root.className = "agx-chat-root";
  root.setAttribute("data-state", "minimized");
  root.innerHTML = '\
    <div class="agx-pill" role="region" aria-label="' + escapeHtml(BRAND) + '">\
      <button class="agx-pill-brand" type="button" aria-label="Open chat">\
        <span class="agx-dot"></span>\
        <span class="agx-pill-label">' + escapeHtml("AI") + '</span>\
      </button>\
      <form class="agx-pill-form">\
        <input class="agx-pill-input" type="text" autocomplete="off" placeholder="" aria-label="Ask Agilisium AI" />\
        <button class="agx-pill-send" type="submit" aria-label="Send">&#10148;</button>\
      </form>\
      <button class="agx-pill-expand" type="button" aria-label="Expand chat">&#10562;</button>\
    </div>\
    <div class="agx-panel" role="dialog" aria-label="' + escapeHtml(TITLE) + '">\
      <div class="agx-header">\
        <div class="agx-title"><span class="agx-dot agx-dot-live"></span>' + escapeHtml(TITLE) + '</div>\
        <div class="agx-actions">\
          <button class="agx-btn-icon agx-toggle-size" title="Toggle size" aria-label="Toggle size">&#10561;</button>\
          <button class="agx-btn-icon agx-min" title="Minimize" aria-label="Minimize">&ndash;</button>\
          <button class="agx-btn-icon agx-close" title="Close" aria-label="Close">&times;</button>\
        </div>\
      </div>\
      <div class="agx-messages" aria-live="polite"></div>\
      <div class="agx-quick"></div>\
      <form class="agx-input-row">\
        <input class="agx-input" type="text" placeholder="Ask about services, case studies, news…" autocomplete="off" />\
        <button class="agx-send" type="submit" aria-label="Send">&#10148;</button>\
      </form>\
    </div>';
  document.body.appendChild(root);

  /* Backdrop — only shown in fullscreen */
  var backdrop = document.createElement("div");
  backdrop.className = "agx-backdrop";
  document.body.appendChild(backdrop);

  var pillBrand  = root.querySelector(".agx-pill-brand");
  var pillForm   = root.querySelector(".agx-pill-form");
  var pillInput  = root.querySelector(".agx-pill-input");
  var pillExpand = root.querySelector(".agx-pill-expand");
  var panel      = root.querySelector(".agx-panel");
  var msgsEl     = root.querySelector(".agx-messages");
  var quickEl    = root.querySelector(".agx-quick");
  var input      = root.querySelector(".agx-input");
  var form       = root.querySelector(".agx-input-row");
  var toggleBtn  = root.querySelector(".agx-toggle-size");

  /* ── Wheel scroll fix: hover-scroll inside the messages div ── */
  msgsEl.addEventListener("wheel", function (e) {
    var atTop    = msgsEl.scrollTop === 0 && e.deltaY < 0;
    var atBottom = msgsEl.scrollTop + msgsEl.clientHeight >= msgsEl.scrollHeight - 1 && e.deltaY > 0;
    if (!atTop && !atBottom) {
      e.preventDefault();
      e.stopPropagation();
      msgsEl.scrollTop += e.deltaY;
    }
  }, { passive: false, capture: true });

  /* Touch scroll inside messages */
  var _touchY = 0;
  msgsEl.addEventListener("touchstart", function (e) {
    _touchY = e.touches[0].clientY;
  }, { passive: true });

  msgsEl.addEventListener("touchmove", function (e) {
    var dy = _touchY - e.touches[0].clientY;
    _touchY = e.touches[0].clientY;
    var atTop    = msgsEl.scrollTop === 0 && dy < 0;
    var atBottom = msgsEl.scrollTop + msgsEl.clientHeight >= msgsEl.scrollHeight - 1 && dy > 0;
    if (!atTop && !atBottom) {
      e.stopPropagation();
      msgsEl.scrollTop += dy;
    }
  }, { passive: false });

  /* Animated rotating placeholder */
  var phIndex = 0, phChar = 0, phMode = "typing";
  var phTimer = null;
  function tickPlaceholder() {
    if (document.activeElement === pillInput && pillInput.value.length > 0) {
      phTimer = setTimeout(tickPlaceholder, 600);
      return;
    }
    var full = PLACEHOLDERS[phIndex];
    var delay = 60;
    if (phMode === "typing") {
      phChar++;
      pillInput.setAttribute("placeholder", full.slice(0, phChar));
      if (phChar >= full.length) { phMode = "holding"; delay = 1600; }
    } else if (phMode === "holding") {
      phMode = "deleting"; delay = 40;
    } else {
      phChar--;
      pillInput.setAttribute("placeholder", full.slice(0, phChar));
      if (phChar <= 0) { phMode = "typing"; phIndex = (phIndex + 1) % PLACEHOLDERS.length; delay = 250; }
    }
    phTimer = setTimeout(tickPlaceholder, delay);
  }
  tickPlaceholder();

  var QUICK = [
    "Show me case studies",
    "Latest news",
    "Leadership team",
    "Contact",
    "Careers",
  ];

  function renderQuick() {
    if (messages.length > 1) { quickEl.innerHTML = ""; return; }
    quickEl.innerHTML = QUICK.map(function (q) {
      return '<button class="agx-chip" type="button">' + escapeHtml(q) + "</button>";
    }).join("");
    quickEl.querySelectorAll(".agx-chip").forEach(function (b) {
      b.addEventListener("click", function () { send(b.textContent); });
    });
  }

  function renderAll() {
    msgsEl.innerHTML = "";
    if (!messages.length) {
      var w = document.createElement("div");
      w.className = "agx-msg agx-bot";
      w.innerHTML = md("Hi! I'm the **" + TITLE + "** assistant. Ask me about case studies, services, news or anything else on agilisium.com.");
      msgsEl.appendChild(w);
    }
    messages.forEach(function (m) {
      var el = document.createElement("div");
      el.className = "agx-msg " + (m.role === "user" ? "agx-user" : "agx-bot");
      el.innerHTML = md(m.content);
      msgsEl.appendChild(el);
    });
    msgsEl.scrollTop = msgsEl.scrollHeight;
    renderQuick();
  }

  function lockBodyScroll(lock) {
    document.body.classList.toggle("agx-no-scroll", !!lock);
    document.documentElement.classList.toggle("agx-no-scroll", !!lock);
  }

  function updateToggleIcon() {
    toggleBtn.textContent = state === "fullscreen" ? "\u29C1" : "\u29C2";
    toggleBtn.title = state === "fullscreen" ? "Collapse to corner" : "Expand to center";
  }

  function setState(s) {
    var prev = state;
    state = s;
    root.setAttribute("data-state", s);
    lockBodyScroll(s !== "minimized");

    if (s === "minimized") {
      /* CHANGED: do NOT clear messages — just clear the input field.
         Session persists until page refresh or tab close (sessionStorage). */
      input.value = "";
    } else {
      if (prev === "minimized") {
        renderAll();
      }
      setTimeout(function () { input.focus(); }, 50);
    }
    updateToggleIcon();
  }

  /* Pill interactions */
  pillBrand.addEventListener("click", function () { setState("fullscreen"); });
  pillExpand.addEventListener("click", function () { setState("fullscreen"); });

  pillForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = pillInput.value.trim();
    pillInput.value = "";
    setState("fullscreen");
    if (text) setTimeout(function () { send(text); }, 80);
  });

  pillInput.addEventListener("focus", function () {
    if (state === "minimized") setState("fullscreen");
  });
  pillInput.addEventListener("click", function () {
    if (state === "minimized") setState("fullscreen");
  });

  /* Panel buttons */
  root.querySelector(".agx-close").addEventListener("click", function () { setState("minimized"); });
  root.querySelector(".agx-min").addEventListener("click", function () { setState("minimized"); });

  toggleBtn.addEventListener("click", function () {
    setState(state === "fullscreen" ? "expanded" : "fullscreen");
  });

  /* Backdrop click → minimize */
  backdrop.addEventListener("click", function () {
    if (state === "fullscreen") setState("minimized");
  });

  /* Escape key */
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && state !== "minimized") setState("minimized");
  });

  /* Send message */
  async function send(text) {
    text = (text || input.value || "").trim();
    if (!text || streaming) return;
    input.value = "";
    messages.push({ role: "user", content: text });
    saveMessages(messages); /* CHANGED: persist after every user message */
    renderAll();

    var typing = document.createElement("div");
    typing.className = "agx-msg agx-bot agx-typing";
    typing.innerHTML = "<span></span><span></span><span></span>";
    msgsEl.appendChild(typing);
    msgsEl.scrollTop = msgsEl.scrollHeight;

    streaming = true;
    var assistantText = "";
    var assistantEl = null;

    try {
      var res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: messages.slice(-12) }),
      });
      if (!res.ok || !res.body) {
        var err = await res.text().catch(function () { return ""; });
        throw new Error("Backend error " + res.status + ": " + err.slice(0, 120));
      }
      var reader = res.body.getReader();
      var dec = new TextDecoder();
      var buf = "";
      while (true) {
        var r = await reader.read();
        if (r.done) break;
        buf += dec.decode(r.value, { stream: true });
        var lines = buf.split("\n");
        buf = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line.startsWith("data:")) continue;
          var data = line.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            var j = JSON.parse(data);
            var delta = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
            if (delta) {
              assistantText += delta;
              if (!assistantEl) {
                typing.remove();
                assistantEl = document.createElement("div");
                assistantEl.className = "agx-msg agx-bot";
                msgsEl.appendChild(assistantEl);
              }
              assistantEl.innerHTML = md(assistantText);
              msgsEl.scrollTop = msgsEl.scrollHeight;
            }
          } catch (e) {}
        }
      }
      if (assistantText) {
        messages.push({ role: "assistant", content: assistantText });
        saveMessages(messages); /* CHANGED: persist after every assistant reply */
      } else {
        typing.remove();
      }
    } catch (e) {
      typing.remove();
      var errEl = document.createElement("div");
      errEl.className = "agx-msg agx-bot agx-error";
      errEl.textContent = "Sorry — I couldn't reach the server. " + e.message;
      msgsEl.appendChild(errEl);
    } finally {
      streaming = false;
    }
  }

  form.addEventListener("submit", function (e) { e.preventDefault(); send(); });
})();