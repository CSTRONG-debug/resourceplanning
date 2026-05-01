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

// Build a compact JSON snapshot of relevant app state. We denormalize names
// into assignments so Claude doesn't have to mentally join IDs across arrays —
// it can see "Chris Salmon assigned to Project #1042" directly.
//
// For very large datasets (thousands of assignments) you would switch to
// tool-use and let Claude query subsets on demand. That's a v2.
export function buildAppContext({
  projects = [], resources = [], crews = [], assignments = [],
  certifications = [], forecastData = null, today = new Date().toISOString().slice(0, 10),
}) {
  // Build ID → entity lookup maps for denormalization.
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const resourceMap = new Map(resources.map((r) => [r.id, r]));
  const crewMap = new Map(crews.map((c) => [c.id, c]));

  return {
    today,
    counts: {
      projects: projects.length,
      resources: resources.length,
      crews: crews.length,
      assignments: assignments.length,
    },
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
    // Assignments are enriched with project/resource/crew names so questions
    // like "when does Chris Salmon become free" can be answered without
    // cross-referencing IDs. start/end are ISO date strings.
    assignments: assignments.map((a) => {
      const project = projectMap.get(a.projectId);
      const resource = resourceMap.get(a.resourceId);
      const crewsOnAssignment = (a.crewIds || [])
        .map((id) => crewMap.get(id))
        .filter(Boolean);
      return {
        id: a.id,
        projectId: a.projectId,
        projectNumber: project?.projectNumber || null,
        projectName: project?.name || null,
        projectDivision: project?.division || null,
        resourceId: a.resourceId || null,
        resourceName: resource?.name || null,
        resourceType: resource?.resourceType || null,
        crewIds: a.crewIds || [],
        crewNames: crewsOnAssignment.map((c) => c.crewName),
        start: a.start,
        end: a.end,
      };
    }),
    certificationsKnown: certifications,
    forecast: forecastData,
  };
}

const SYSTEM_PROMPT = `You are an assistant embedded in Greater Georgia Concrete's internal Resource Planning application. You help schedulers, foremen, and managers with their work.

Each user message includes a JSON snapshot of current app state under "Current app state". Use ONLY that data. Do not invent project numbers, names, dates, or numbers. Today's date is provided as context.today.

# Data shapes

The snapshot contains these arrays. They are SEPARATE — don't confuse them:

- **projects**: construction projects (division, status, type, client). No dates here.
- **resources**: individual people (foremen, operators, laborers) with their resourceType and certifications. Each certification has start/expiration dates.
- **crews**: named crews with foreman, member count, and specialties. May be deactivated.
- **assignments**: THIS IS THE SCHEDULE. Each assignment links a resource and/or crew to a project for a date range (start to end, ISO format). Already enriched with projectName, resourceName, crewNames so you don't need to join by ID.
- **forecast**: revenue forecasting only ($/month projections). Often null. NOT related to scheduling.

# How to answer common questions

* "Who/which crews are available [next week / on date X]?"
  → Look at assignments. Compute the date range from context.today. A resource/crew is BUSY during a range if any of their assignments overlap. Otherwise AVAILABLE. List by name.

* "When does [person] become free?" / "When is [crew] next available?"
  → Find their assignments by resourceName or crewNames. Return the latest end date. They become free the day after.

* "Whose certifications expire in the next N days?"
  → Walk resources[].certifications[].expiration. Compare to context.today. Group by resource.

* "Suggest a crew for [project]"
  → Match crew specialty/division to the project. Prefer crews not currently assigned during the project window (check assignments). Mention required certifications if relevant.

* "Summarize the forecast" / revenue questions
  → Use the forecast field. If null, say "no forecast data was passed to me — that feature isn't wired up yet" and stop.

* "How many [X]?" / general inventory
  → Use the counts object or count the relevant array.

# Style

Concise. Plain prose for short answers. Short bullet lists when listing 3+ items. Reference projects by projectNumber and people by name, not internal IDs. Don't repeat JSON back. Don't narrate your reasoning unless asked.

If a question genuinely cannot be answered from the data, name the SPECIFIC field that's missing or empty (not just "I need more data"). For example: "There are 0 assignments in the snapshot, so I can't tell who's busy" is good; "I need forecast data" is wrong if the question was about scheduling.`;

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
