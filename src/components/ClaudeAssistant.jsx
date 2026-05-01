// src/components/ClaudeAssistant.jsx
//
// Slide-over panel that lets a logged-in (or not-yet-logged-in) user connect
// their personal Anthropic API key and chat with Claude about app data.
//
// Two entry points are expected from the parent:
//   - A "Connect Claude" button on the login screen (beside "Log In").
//   - A sparkles button in the post-login header.
// Both just toggle `open`. Connection state is managed inside this component
// via sessionStorage helpers from ../lib/claude.

import React, { useState, useRef, useEffect } from "react";
import {
  Sparkles, X, Send, KeyRound, AlertTriangle, ExternalLink, Trash2, Info,
} from "lucide-react";
import {
  getStoredApiKey, setStoredApiKey, clearStoredApiKey, hasClaudeKey,
  looksLikeAnthropicKey, verifyApiKey,
  getStoredModel, setStoredModel, AVAILABLE_MODELS,
  buildAppContext, askClaude,
} from "../lib/claude";

export default function ClaudeAssistant({ open, onClose, appData }) {
  const [connected, setConnected] = useState(hasClaudeKey());
  const [model, setModel] = useState(getStoredModel());

  // Connect form state
  const [keyInput, setKeyInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");

  // Chat state
  const [messages, setMessages] = useState([]); // {role, text, error?}
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  // Re-check connection state whenever the panel is opened (in case the
  // session was cleared elsewhere).
  useEffect(() => {
    if (open) setConnected(hasClaudeKey());
  }, [open]);

  if (!open) return null;

  async function handleConnect(e) {
    e.preventDefault();
    setVerifyError("");
    const trimmed = keyInput.trim();
    if (!looksLikeAnthropicKey(trimmed)) {
      setVerifyError("That doesn't look like an Anthropic API key — they start with sk-ant-.");
      return;
    }
    setVerifying(true);
    setStoredApiKey(trimmed);
    setStoredModel(model);
    try {
      await verifyApiKey(trimmed, model);
      setConnected(true);
      setKeyInput("");
    } catch (err) {
      clearStoredApiKey();
      setVerifyError(err.message || "Could not verify the key.");
    } finally {
      setVerifying(false);
    }
  }

  function handleDisconnect() {
    clearStoredApiKey();
    setConnected(false);
    setMessages([]);
  }

  async function handleSend(e) {
    e?.preventDefault?.();
    const q = input.trim();
    if (!q || busy) return;
    const next = [...messages, { role: "user", text: q }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const ctx = buildAppContext(appData || {});
      // Convert prior chat turns to the API's message format.
      const conversation = next.slice(0, -1).map((m) => ({
        role: m.role,
        content: m.text,
      }));
      const { text } = await askClaude({
        userQuestion: q, appContext: ctx, conversation,
      });
      setMessages((m) => [...m, { role: "assistant", text }]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: `⚠️ ${err.message || "Request failed."}`, error: true },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside
      className="fixed top-0 right-0 z-[90] flex h-full w-full max-w-lg flex-col border-l border-slate-200 bg-white shadow-2xl"
      role="complementary"
      aria-label="Claude Assistant"
    >
      <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-700 text-white">
            <Sparkles size={18} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Claude Assistant</h2>
            <p className="text-xs text-slate-500">
              {connected ? `Connected · ${shortModelName(model)}` : "Not connected"}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
          aria-label="Close"
        >
          <X size={20} />
        </button>
      </header>

        {!connected ? (
          <ConnectPanel
            keyInput={keyInput} setKeyInput={setKeyInput}
            model={model} setModel={setModel}
            verifying={verifying} verifyError={verifyError}
            onSubmit={handleConnect}
          />
        ) : (
          <>
            <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto bg-slate-50 px-5 py-4">
              {messages.length === 0 && <EmptyState />}
              {messages.map((m, i) => (
                <Message key={i} role={m.role} text={m.text} error={m.error} />
              ))}
              {busy && <Message role="assistant" text="Thinking…" pending />}
            </div>
            <form onSubmit={handleSend} className="border-t border-slate-200 bg-white p-3">
              <div className="flex items-end gap-2">
                <textarea
                  rows={2}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Ask about projects, suggest crews, summarize the forecast…"
                  disabled={busy}
                  className="flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-600 disabled:bg-slate-50"
                />
                <button
                  type="submit"
                  disabled={busy || !input.trim()}
                  className="rounded-xl bg-emerald-700 p-3 text-white hover:bg-emerald-800 disabled:bg-slate-300"
                  aria-label="Send"
                >
                  <Send size={16} />
                </button>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
                <span>Enter to send · Shift+Enter for newline</span>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="flex items-center gap-1 text-slate-500 hover:text-red-600"
                >
                  <Trash2 size={12} /> Disconnect
                </button>
              </div>
            </form>
          </>
        )}
    </aside>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function ConnectPanel({ keyInput, setKeyInput, model, setModel, verifying, verifyError, onSubmit }) {
  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-y-auto p-5">
      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        <div className="flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div className="space-y-1.5">
            <p className="font-semibold">How this works — please read</p>
            <ul className="list-disc space-y-1 pl-4 leading-relaxed">
              <li>Your API key is stored only in this browser tab. It is wiped when you close the tab and is <strong>never</strong> sent to GGC's servers or saved in Supabase.</li>
              <li>Project data sent to Claude goes directly from your browser to Anthropic. Per Anthropic's commercial API terms, API content is not used to train models.</li>
              <li>Usage is billed to your personal Anthropic API account. Requires a <strong>paid</strong> Anthropic account with credits — a free claude.ai web subscription does not include API access.</li>
            </ul>
          </div>
        </div>
      </div>

      <label className="mb-3 block">
        <span className="mb-1 block text-sm font-semibold text-slate-700">Anthropic API key</span>
        <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 focus-within:border-emerald-600">
          <KeyRound size={16} className="text-slate-400" />
          <input
            type="password"
            autoComplete="off"
            spellCheck="false"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="sk-ant-…"
            className="flex-1 bg-transparent text-sm outline-none"
          />
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          Get one at{" "}
          <a
            href="https://console.anthropic.com/settings/keys"
            target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-emerald-700 underline hover:text-emerald-800"
          >
            console.anthropic.com <ExternalLink size={10} />
          </a>
        </p>
      </label>

      <label className="mb-4 block">
        <span className="mb-1 block text-sm font-semibold text-slate-700">Model</span>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-600"
        >
          {AVAILABLE_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <p className="mt-1.5 flex items-start gap-1 text-xs text-slate-500">
          <Info size={11} className="mt-0.5 shrink-0" />
          You can change this later. Sonnet is a good default for everyday questions.
        </p>
      </label>

      {verifyError && (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {verifyError}
        </div>
      )}

      <button
        type="submit"
        disabled={verifying || !keyInput.trim()}
        className="rounded-xl bg-emerald-700 px-4 py-2.5 font-semibold text-white hover:bg-emerald-800 disabled:bg-slate-300"
      >
        {verifying ? "Verifying…" : "Connect"}
      </button>
    </form>
  );
}

function EmptyState() {
  const examples = [
    "Which crews are free next week and certified for hardscape?",
    "Summarize Q3 forecast and flag months that look thin.",
    "Whose certifications expire in the next 60 days?",
    "Suggest a crew for project #1042 — masonry, downtown, starts Monday.",
  ];
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-4">
      <p className="mb-2 text-sm font-semibold text-slate-700">Try asking…</p>
      <ul className="space-y-1.5 text-xs text-slate-600">
        {examples.map((e, i) => (
          <li key={i}>• {e}</li>
        ))}
      </ul>
    </div>
  );
}

function Message({ role, text, error, pending }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
          isUser
            ? "bg-emerald-700 text-white"
            : error
            ? "border border-red-200 bg-red-50 text-red-800"
            : "border border-slate-200 bg-white text-slate-800"
        } ${pending ? "italic text-slate-500" : ""}`}
      >
        {text}
      </div>
    </div>
  );
}

function shortModelName(id) {
  const found = AVAILABLE_MODELS.find((m) => m.id === id);
  if (found) return found.label.split(" — ")[0];
  return id;
}
