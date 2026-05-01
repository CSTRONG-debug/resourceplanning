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

// Build a compact JSON snapshot of relevant app state.
//
// IMPORTANT — this app's actual data model:
//   - Assignments use NAMED ROLE FIELDS (projectManager, superintendent,
//     fieldCoordinator, fieldEngineer, safety) holding person-name strings,
//     not foreign keys to resources.
//   - The actual scheduled time blocks live in assignment.mobilizations[],
//     each with its own start/end and per-mobilization superintendent /
//     fieldCoordinator / crewIds overrides.
//   - PTO lives on resource.pto[] — a separate dimension from assignments.
//
// We flatten all of this into two flat arrays (scheduledBlocks, ptoBlocks)
// so Claude can answer "who's busy / who's free / when is X available"
// without traversing nested structures or guessing field names.
export function buildAppContext({
  projects = [], resources = [], crews = [], assignments = [],
  certifications = [], forecastData = null, today = new Date().toISOString().slice(0, 10),
}) {
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const crewMap = new Map(crews.map((c) => [c.id, c]));

  // Flatten assignments → scheduledBlocks (one row per mobilization).
  const scheduledBlocks = [];
  for (const a of assignments) {
    const project = projectMap.get(a.projectId);
    // Legacy fallback: assignment without mobilizations uses assignment-level
    // fields directly. Newer assignments always have a mobilizations array.
    const mobs = (a.mobilizations && a.mobilizations.length)
      ? a.mobilizations
      : [{
          id: null,
          start: a.start || null,
          end: a.end || null,
          superintendent: a.superintendent || "",
          fieldCoordinator: a.fieldCoordinator || "",
          crewIds: [a.crew1Id, a.crew2Id, a.crew3Id, a.crew4Id].filter(Boolean),
          unassignedNeeds: [],
        }];

    mobs.forEach((mob, i) => {
      const isFirst = i === 0;
      // Mobilization-level superintendent/fieldCoordinator override
      // assignment-level. First mobilization falls back to assignment-level
      // if its own field is blank — matches the app's own form behavior.
      const superintendent = mob.superintendent || (isFirst ? (a.superintendent || "") : "") || null;
      const fieldCoordinator = mob.fieldCoordinator || (isFirst ? (a.fieldCoordinator || "") : "") || null;
      const mobCrewIds = (mob.crewIds && mob.crewIds.length)
        ? mob.crewIds
        : (isFirst ? [a.crew1Id, a.crew2Id, a.crew3Id, a.crew4Id].filter(Boolean) : []);
      const crewNames = mobCrewIds.map((id) => crewMap.get(id)?.crewName).filter(Boolean);

      scheduledBlocks.push({
        assignmentId: a.id,
        mobilizationId: mob.id || null,
        projectId: a.projectId,
        projectNumber: project?.projectNumber || null,
        projectName: project?.name || null,
        projectDivision: project?.division || null,
        start: mob.start || null,
        end: mob.end || null,
        // Assignment-level roles (apply to all mobilizations in the assignment)
        projectManager: a.projectManager || null,
        fieldEngineer: a.fieldEngineer || null,
        safety: a.safety || null,
        // Per-mobilization roles
        superintendent,
        fieldCoordinator,
        crewNames,
        unassignedNeeds: mob.unassignedNeeds || [],
      });
    });
  }

  // Flatten resource.pto[] → ptoBlocks.
  const ptoBlocks = [];
  for (const r of resources) {
    for (const p of (r.pto || [])) {
      ptoBlocks.push({
        resourceName: r.name,
        ptoId: p.ptoId || null,
        start: p.start || null,
        end: p.end || null,
      });
    }
  }

  return {
    today,
    counts: {
      projects: projects.length,
      resources: resources.length,
      crews: crews.length,
      assignments: assignments.length,
      scheduledBlocks: scheduledBlocks.length,
      ptoBlocks: ptoBlocks.length,
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
    scheduledBlocks,
    ptoBlocks,
    certificationsKnown: certifications,
    forecast: forecastData,
  };
}

const SYSTEM_PROMPT = `You are an assistant embedded in Greater Georgia Concrete's internal Resource Planning application. You help schedulers, foremen, and managers with their work.

Each user message includes a JSON snapshot of current app state under "Current app state". Use ONLY that data. Do not invent project numbers, names, dates, or numbers. Today's date is provided as context.today.

# Data shapes

The snapshot contains these arrays. They are SEPARATE — don't confuse them:

- **projects**: construction projects (division, status, type, client). No dates here.
- **resources**: individual people (foremen, operators, superintendents, etc.) with resourceType and certifications. Each certification has start/expiration dates.
- **crews**: named crews with foreman, member count, and specialties. May be deactivated.
- **scheduledBlocks**: THE SCHEDULE. One row per mobilization (date block). Each block names who is on it via these role fields, all of which are PERSON NAMES as strings (or null):
    - projectManager, superintendent, fieldCoordinator, fieldEngineer, safety
  Plus crewNames (array of crew name strings). Plus start/end (ISO dates) and projectNumber/projectName/projectDivision.
- **ptoBlocks**: PTO time off. resourceName + start + end. SEPARATE from scheduledBlocks.
- **forecast**: revenue forecasting only (often null). NOT related to scheduling.

# How to answer common questions

* "When does [person] become free?" / "When is [person] next available?"
  → Search scheduledBlocks for any block where the person's NAME appears in any role field (projectManager, superintendent, fieldCoordinator, fieldEngineer, safety). Also search ptoBlocks where resourceName matches. Return the latest end date across all of those. They become free the day AFTER that date.

* "Who's on project [X]?" / "Who's the superintendent on [X]?"
  → Filter scheduledBlocks by projectNumber or projectName (case-insensitive substring matching is fine). Each block lists the role assignments and crews.

* "Which crews/people are available [next week / on date X]?"
  → Compute the date range from context.today. A person is BUSY in that range if their name appears in any role on a scheduledBlock whose [start, end] overlaps the range, OR in a ptoBlock that overlaps. Otherwise AVAILABLE. Same logic for crews against block.crewNames. List people from \`resources\` and crews from \`crews\` who are NOT busy.

* "Whose certifications expire in the next N days?"
  → Walk resources[].certifications[].expiration. Compare to context.today. Group by resource.

* "Suggest a crew for [project]"
  → Match crew specialty/division to the project. Prefer crews not appearing in any scheduledBlock.crewNames during the project window. Mention required certifications if relevant.

* "Summarize the forecast" / revenue questions
  → Use the forecast field. If null, say "no forecast data was passed to me — that feature isn't wired up yet" and stop.

* "How many [X]?" / general inventory
  → Use the counts object or count the relevant array.

# Style

Concise. Plain prose for short answers. Short bullet lists when listing 3+ items. Reference projects by projectNumber and people by name, not internal IDs. Don't repeat JSON back. Don't narrate your reasoning unless asked.

If a question genuinely cannot be answered from the data, name the SPECIFIC field that's empty (e.g. "scheduledBlocks is empty so I can't tell who's busy"). Don't say "I need forecast data" if the question was about scheduling.`;

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
