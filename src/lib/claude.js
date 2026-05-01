// src/lib/claude.js
// Per-user Claude integration for the GGC Resource Planning app.
//
// Design constraints (read these before changing anything):
//   1. The user's Anthropic API key lives ONLY in sessionStorage. It is wiped
//      automatically when the browser tab closes. It is NEVER persisted to
//      Supabase, posted to GGC's backend, or logged.
//   2. API calls go directly from the user's browser to api.anthropic.com.
//      Project data never passes through GGC infrastructure on its way to Claude.
//   3. Anthropic's commercial API terms specify that API inputs and outputs are
//      not used to train models. Internal data is not "sent to the main machine"
//      in the sense of training data.
//
// To use the API directly from the browser, Anthropic requires the
// `anthropic-dangerous-direct-browser-access: true` header. This is documented
// and supported. The risk it warns about (key visible in network tab) is
// acceptable here because the key belongs to the user and never leaves their
// own machine.

const STORAGE_KEY = "ggc_claude_api_key";
const MODEL_KEY = "ggc_claude_model";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

export const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

export const AVAILABLE_MODELS = [
  { id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5 — recommended" },
  { id: "claude-opus-4-1-20250805",   label: "Claude Opus 4.1 — most capable, costs more" },
  { id: "claude-haiku-4-5-20251001",  label: "Claude Haiku 4.5 — fastest, cheapest" },
];

// ── API key storage ────────────────────────────────────────────────────────

export function getStoredApiKey() {
  try { return sessionStorage.getItem(STORAGE_KEY) || ""; } catch { return ""; }
}

export function setStoredApiKey(key) {
  try {
    if (key) sessionStorage.setItem(STORAGE_KEY, key);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore — private mode etc. */ }
}

export function clearStoredApiKey() { setStoredApiKey(""); }
export function hasClaudeKey() { return Boolean(getStoredApiKey()); }

export function getStoredModel() {
  try { return sessionStorage.getItem(MODEL_KEY) || DEFAULT_MODEL; } catch { return DEFAULT_MODEL; }
}
export function setStoredModel(model) {
  try {
    if (model) sessionStorage.setItem(MODEL_KEY, model);
    else sessionStorage.removeItem(MODEL_KEY);
  } catch { /* ignore */ }
}

// Anthropic keys begin with "sk-ant-". Quick client-side sanity check.
export function looksLikeAnthropicKey(key) {
  return typeof key === "string" && /^sk-ant-/.test(key.trim());
}

// ── API call ───────────────────────────────────────────────────────────────

async function callAnthropic({ key, model, system, messages, maxTokens = 1500 }) {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.error?.message || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return res.json();
}

// Verify a key by sending a minimal request. Throws on failure.
export async function verifyApiKey(key, model = getStoredModel()) {
  await callAnthropic({
    key, model,
    messages: [{ role: "user", content: "ping" }],
    maxTokens: 4,
  });
  return true;
}

// ── App context for the system prompt ──────────────────────────────────────

// Build a compact JSON snapshot of relevant app state. We keep it lean because
// large contexts cost more tokens. For very large datasets you would switch to
// tool-use and let Claude query subsets on demand — that's a v2.
export function buildAppContext({
  projects = [], resources = [], crews = [], assignments = [],
  certifications = [], forecastData = null, today = new Date().toISOString().slice(0, 10),
}) {
  return {
    today,
    projects: projects.map((p) => ({
      id: p.id,
      projectNumber: p.projectNumber,
      name: p.name,
      client: p.client,
      division: p.division,
      status: p.status,
      projectType: p.projectType,
      includeInForecast: !!p.includeInForecast,
    })),
    resources: resources.map((r) => ({
      id: r.id,
      name: r.name,
      resourceType: r.resourceType,
      certifications: (r.certifications || []).map((c) =>
        typeof c === "string"
          ? { name: c }
          : { name: c.name, start: c.start || null, expiration: c.expiration || null }
      ),
    })),
    crews: crews.map((c) => ({
      id: c.id,
      crewName: c.crewName,
      foremanName: c.foremanName,
      totalMembers: c.totalMembers,
      specialty: c.specialty,
      deactivated: !!c.deactivated,
    })),
    assignments: assignments.map((a) => ({
      id: a.id,
      projectId: a.projectId,
      resourceId: a.resourceId,
      crewIds: a.crewIds || [],
      start: a.start,
      end: a.end,
    })),
    certificationsKnown: certifications,
    forecast: forecastData,
  };
}

const SYSTEM_PROMPT = `You are an assistant embedded in Greater Georgia Concrete's internal Resource Planning application. You help schedulers, foremen, and managers with three jobs:

1. Answering questions about projects, resources, crews, certifications, and assignments.
2. Suggesting crew assignments based on availability, division fit, and required certifications.
3. Summarizing the forecast and flagging risks: expiring certifications, scheduling conflicts, thin months, overruns.

Each user message will include a JSON snapshot of the current app state under "Current app state". Use ONLY that data. Do not invent project numbers, names, dates, or numbers. If a question cannot be answered from the data, say so plainly and suggest what data would be needed.

Style: concise. Plain prose for short answers. Short bullet lists when listing 3+ items. When suggesting a crew, give one or two sentences of reasoning (which certs match, which division, current load). Never narrate your process.

Treat all data as confidential to GGC. Do not repeat the entire JSON back; reference specific items by project number or name.`;

// Send a question + app context and return Claude's text reply.
// `conversation` is prior turns in {role, content} form for follow-ups.
export async function askClaude({ userQuestion, appContext, conversation = [] }) {
  const key = getStoredApiKey();
  if (!key) throw new Error("Claude is not connected. Add your API key first.");
  const model = getStoredModel();

  const messages = [
    ...conversation,
    {
      role: "user",
      content:
        `Current app state:\n\`\`\`json\n${JSON.stringify(appContext)}\n\`\`\`\n\n` +
        `Question: ${userQuestion}`,
    },
  ];

  const data = await callAnthropic({ key, model, system: SYSTEM_PROMPT, messages });
  const text = (data.content || [])
    .map((b) => (b.type === "text" ? b.text : ""))
    .filter(Boolean)
    .join("\n\n");
  return { text, raw: data };
}
