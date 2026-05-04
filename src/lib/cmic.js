// src/lib/cmic.js
//
// Client-side helpers for the CMiC integration.
// Calls the Supabase Edge Function (`cmic-proxy`) which holds CMiC creds
// server-side. This file knows nothing about CMiC credentials — only about
// the proxy endpoint and how to map CMiC field names to your app's schema.

import { supabase } from "./supabase";

// ── Field mapping (EDIT ME) ────────────────────────────────────────────────
//
// This map tells us which CMiC field on a JC Job corresponds to each field
// on your local project record. These are placeholders based on the most
// common CMiC field names — verify against one real job from your tenant
// and adjust before going live.
//
// To check: temporarily call `await fetchCmicJobs()` in the console, look at
// the raw items, and confirm that each CMiC_FIELDS value below holds the data
// you actually use.
export const CMIC_FIELDS = {
  projectNumber: "JobCode",       // commonly JobCode; sometimes JobBidCode
  name:          "JobName",
  client:        "JobBillCustCode", // may be JobCustCode or a related Name field
  division:      "JobBillDeptCode", // GGC may use a custom field — confirm
  status:        "JobStatusCode",   // single letter code: A/I/O/C/etc
  projectType:   "JobTypeCode",     // may not exist; can be left null
  contractValue: "JobContractAmt", // current contract incl. approved change orders
                                   // (NOT JobBillAmt — that's billed-to-date,
                                   // and NOT JobOriginalContractAmt — that's
                                   // frozen at job creation)
};

// Map CMiC's single-letter JobStatusCode to your app's status strings.
// GGC's app does not use "In Progress" as a status — both CMiC's "I" and
// "P" (the active/in-progress codes) collapse to "Active" here.
const STATUS_MAP = {
  A: "Active",
  I: "Active",     // CMiC "In Progress" → GGC "Active"
  O: "Open",
  C: "Complete",
  H: "On Hold",
  P: "Active",     // CMiC "Posted" (also active in some tenants)
};

// Map CMiC's short division/department codes to your app's full names.
// CMiC stores divisions as abbreviations like "CM", "HS", "IN" — we expand
// to full names so they sort/filter correctly with the rest of your app.
// Add/edit here if you add divisions later.
const DIVISION_MAP = {
  CM: "Commercial",
  HS: "Hardscape",
  IN: "Industrial",
};

// ── Edge Function caller ──────────────────────────────────────────────────

async function callProxy(path) {
  // supabase.functions.invoke handles auth headers & URL construction.
  // Path is the part after the function name, e.g. "/jobs?status=active".
  const { data, error } = await supabase.functions.invoke(
    "cmic-proxy" + path,
    { method: "GET" }
  );
  if (error) throw new Error(error.message || "CMiC proxy call failed");
  if (data?.error) throw new Error(data.error);
  return data;
}

// ── Public API ─────────────────────────────────────────────────────────────

// Quick health check — useful for the settings page.
export async function checkCmicConnection() {
  return callProxy("/health");
}

// Pull the active CMiC jobs. Returns BOTH the raw CMiC items and the mapped
// local-shape projects, so the UI can show a meaningful diff.
export async function fetchCmicJobs({ status = "active" } = {}) {
  const data = await callProxy(`/jobs?status=${encodeURIComponent(status)}`);
  const items = data.items || [];
  const mapped = items.map(mapCmicJobToProject);
  return { raw: items, mapped, count: data.count };
}

// Convert raw CMiC dollar amount to thousands (the unit your forecast uses).
// CMiC sends $1,500,000 as 1500000.00; your forecast stores 1500. Round to
// the nearest whole thousand to avoid noise from cents in the diff.
function toThousands(rawAmount) {
  if (rawAmount == null || rawAmount === "") return null;
  const n = Number(rawAmount);
  if (!Number.isFinite(n)) return null;
  return Math.round(n / 1000);
}

// Refresh contract values for the projects that originated from CMiC.
// Strategy: ONE bulk call to fetch all CMiC jobs, then match locally by
// JobCode === projectNumber. This is much faster than per-project calls
// and avoids the path-format problem (CMiC's single-record GET expects
// JobVUuid, not JobCode).
//
// Returns an array of { projectId, projectNumber, name, currentValue,
// cmicValue, changed, error } — one entry per local project.
export async function fetchContractValueUpdates(localProjects) {
  // Single bulk call — same one the Pull Projects button uses, just with
  // status=all so we don't lose visibility on jobs that may have moved
  // status since the last pull (we still want to refresh those values).
  let cmicJobsByCode;
  try {
    const data = await callProxy(`/jobs?status=all`);
    const items = data.items || [];
    cmicJobsByCode = new Map(
      items.map((j) => [String(pickField(j, CMIC_FIELDS.projectNumber)), j])
    );
  } catch (err) {
    // If the bulk call itself fails, propagate as a single error so the
    // UI can surface it once instead of 91 times.
    throw new Error(`Could not fetch jobs from CMiC: ${err.message}`);
  }

  const updates = [];
  for (const p of localProjects) {
    if (!p.projectNumber) continue;

    const job = cmicJobsByCode.get(String(p.projectNumber));
    if (!job) {
      updates.push({
        projectId: p.id,
        projectNumber: p.projectNumber,
        name: p.name,
        currentValue: p.contractValue ?? null,
        cmicValue: null,
        changed: false,
        error: "Not found in CMiC",
      });
      continue;
    }

    const cmicValue = toThousands(pickField(job, CMIC_FIELDS.contractValue));
    const currentValue = p.contractValue ?? null;
    // Compare as numbers to avoid 1000 vs "1000" false positives.
    const a = currentValue == null ? null : Number(currentValue);
    const b = cmicValue == null ? null : Number(cmicValue);
    const changed = a !== b;

    updates.push({
      projectId: p.id,
      projectNumber: p.projectNumber,
      name: p.name,
      currentValue,
      cmicValue,
      changed,
      error: null,
    });
  }

  return updates;
}

// ── Mapping ───────────────────────────────────────────────────────────────

// CMiC sometimes nests fields or returns single-item containers. Be defensive.
function pickField(job, fieldName) {
  if (!job || !fieldName) return null;
  // Single-item GET responses come back as { items: [job] } sometimes.
  if (job.items && Array.isArray(job.items) && job.items[0]) {
    return job.items[0][fieldName] ?? null;
  }
  return job[fieldName] ?? null;
}

function mapStatus(cmicStatus) {
  return STATUS_MAP[cmicStatus] || cmicStatus || "Active";
}

function mapDivision(cmicDivision) {
  if (!cmicDivision) return "";
  // Try the lookup first; if there's no match, return the original code so
  // we don't lose info. Add the new code to DIVISION_MAP if this happens.
  return DIVISION_MAP[cmicDivision] || cmicDivision;
}

// Convert a CMiC job object to your local project shape. Keep CMiC's raw
// JobCode in projectNumber so the contract-refresh button can find it later.
export function mapCmicJobToProject(job) {
  return {
    projectNumber: pickField(job, CMIC_FIELDS.projectNumber),
    name:          pickField(job, CMIC_FIELDS.name),
    client:        pickField(job, CMIC_FIELDS.client) || "",
    division:      mapDivision(pickField(job, CMIC_FIELDS.division)),
    status:        mapStatus(pickField(job, CMIC_FIELDS.status)),
    projectType:   pickField(job, CMIC_FIELDS.projectType) || "",
    contractValue: toThousands(pickField(job, CMIC_FIELDS.contractValue)),
    // Default to true so newly-imported projects show up in the Forecast
    // tab automatically — this is what GGC wants per the user request.
    includeInForecast: true,
    // Mark provenance so we can show a CMiC badge in the UI.
    source: "cmic",
  };
}

// Compute a diff between CMiC jobs and existing local projects, matched by
// projectNumber. Returns three buckets: toCreate, toUpdate, unchanged.
export function diffCmicAgainstLocal(cmicMapped, localProjects) {
  const localByNumber = new Map(
    localProjects.filter((p) => p.projectNumber).map((p) => [String(p.projectNumber), p])
  );

  const toCreate = [];
  const toUpdate = [];
  const unchanged = [];

  for (const incoming of cmicMapped) {
    if (!incoming.projectNumber) continue;
    const existing = localByNumber.get(String(incoming.projectNumber));
    if (!existing) {
      toCreate.push(incoming);
      continue;
    }
    const changes = {};
    for (const key of ["name", "client", "division", "status", "projectType"]) {
      const a = existing[key];
      const b = incoming[key];
      // Loose comparison so "" vs null doesn't trigger a noisy update.
      if ((a ?? "") !== (b ?? "")) changes[key] = { from: a, to: b };
    }
    if (Object.keys(changes).length === 0) unchanged.push({ existing, incoming });
    else toUpdate.push({ existing, incoming, changes });
  }

  return { toCreate, toUpdate, unchanged };
}
