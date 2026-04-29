import React, { useState, useEffect, useRef } from "react";
import { Search } from "lucide-react";
import { toggleListValue, findProject, getCrewDisplayName } from "../../utils";

// ─── StatCard ────────────────────────────────────────────────────────────────

export function StatCard({ icon: Icon, label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{value}</p>
        </div>
        <div className="rounded-xl bg-emerald-50 p-3 text-emerald-700">
          <Icon size={24} />
        </div>
      </div>
    </div>
  );
}

// ─── MultiSelectFilter ───────────────────────────────────────────────────────

export function MultiSelectFilter({ label, options, selected, setSelected, labels = {} }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="mb-2 text-sm font-semibold text-slate-700">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = selected.includes(option);
          return (
            <button
              key={option}
              onClick={() => setSelected((current) => toggleListValue(current, option))}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                active ? "bg-emerald-700 text-white" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
              }`}
            >
              {labels[option] || option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── SearchableMultiSelect ───────────────────────────────────────────────────

export function SearchableMultiSelect({ label, options, selected, setSelected, getLabel }) {
  const containerRef = useRef(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = options.filter((option) =>
    getLabel(option).toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div ref={containerRef} className="relative rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="mb-2 text-sm font-semibold text-slate-700">{label}</p>

      <div className="mb-2 flex flex-wrap gap-2">
        {selected.map((value) => {
          const option = options.find((item) => item.value === value);
          if (!option) return null;
          return (
            <span key={value} className="inline-flex items-center gap-2 rounded-full bg-emerald-700 px-3 py-1 text-xs font-semibold text-white">
              {getLabel(option)}
              <button type="button" onClick={() => setSelected((current) => current.filter((item) => item !== value))}>×</button>
            </span>
          );
        })}
      </div>

      <div className="flex items-center rounded-xl border border-slate-300 bg-white px-3 py-2 focus-within:border-emerald-600">
        <Search size={16} className="mr-2 text-slate-400" />
        <input
          className="w-full bg-transparent outline-none"
          value={query}
          placeholder="Search and select..."
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        />
      </div>

      {open && (
        <div className="absolute left-3 right-3 z-50 mt-1 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {filtered.length ? filtered.map((option) => {
            const active = selected.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setSelected((current) =>
                    current.includes(option.value)
                      ? current.filter((value) => value !== option.value)
                      : [...current, option.value]
                  );
                  setQuery("");
                  setOpen(true);
                }}
                className={`block w-full px-3 py-2 text-left hover:bg-emerald-50 ${active ? "bg-emerald-50" : ""}`}
              >
                <p className="font-semibold text-slate-800">{getLabel(option)}</p>
                {option.subLabel && <p className="text-xs text-slate-500">{option.subLabel}</p>}
              </button>
            );
          }) : <p className="px-3 py-2 text-sm text-slate-500">No matching options</p>}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="block w-full border-t border-slate-200 px-3 py-2 text-center text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}

// ─── CertificationPicker ─────────────────────────────────────────────────────

export function CertificationPicker({ selected, onChange, certifications }) {
  return (
    <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
      {certifications.map((cert) => {
        const active = selected.includes(cert);
        return (
          <button
            key={cert}
            type="button"
            onClick={() => onChange(toggleListValue(selected, cert))}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              active ? "bg-emerald-700 text-white" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
            }`}
          >
            {cert}
          </button>
        );
      })}
    </div>
  );
}

// ─── useCloseDropdown ─────────────────────────────────────────────────────────

export function useCloseDropdown(setOpen, containerRef) {
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false);
    }
    function handleEsc(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [setOpen, containerRef]);
}

// ─── SearchableResourceSelect ─────────────────────────────────────────────────

export function SearchableResourceSelect({ value, onChange, resources, resourceType, placeholder }) {
  const containerRef = useRef(null);
  const [query, setQuery] = useState(value || "");
  const [open, setOpen] = useState(false);

  useCloseDropdown(setOpen, containerRef);
  useEffect(() => setQuery(value || ""), [value]);

  const filtered = resources.filter(
    (r) => (resourceType ? r.resourceType === resourceType : true) &&
      r.name.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center rounded-xl border border-slate-300 px-3 py-2 focus-within:border-emerald-600">
        <Search size={16} className="mr-2 text-slate-400" />
        <input
          className="w-full outline-none"
          value={query}
          placeholder={placeholder || "Search resource..."}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); onChange(e.target.value); setOpen(true); }}
        />
      </div>
      {open && (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {filtered.length ? filtered.map((r) => (
            <button key={r.id} type="button"
              onClick={() => { onChange(r.name); setQuery(r.name); setOpen(false); }}
              className="block w-full px-3 py-2 text-left hover:bg-emerald-50"
            >
              <p className="font-semibold text-slate-800">{r.name}</p>
              <p className="text-xs text-slate-500">{r.resourceType} • {r.homeDivision}</p>
            </button>
          )) : <p className="px-3 py-2 text-sm text-slate-500">No matching resource</p>}
        </div>
      )}
    </div>
  );
}

// ─── SearchableProjectSelect ──────────────────────────────────────────────────

export function SearchableProjectSelect({ value, onChange, projects }) {
  const containerRef = useRef(null);
  const current = findProject(projects, value);
  const [query, setQuery] = useState(current ? `${current.projectNumber} - ${current.name}` : "");
  const [open, setOpen] = useState(false);

  useCloseDropdown(setOpen, containerRef);

  useEffect(() => {
    const selected = findProject(projects, value);
    setQuery(selected ? `${selected.projectNumber} - ${selected.name}` : "");
  }, [value, projects]);

  const filtered = projects.filter((p) =>
    `${p.projectNumber} ${p.name} ${p.client}`.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center rounded-xl border border-slate-300 px-3 py-2 focus-within:border-emerald-600">
        <Search size={16} className="mr-2 text-slate-400" />
        <input
          className="w-full outline-none"
          value={query}
          placeholder="Search project..."
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); onChange(""); setOpen(true); }}
        />
      </div>
      {open && (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {filtered.length ? filtered.map((p) => (
            <button key={p.id} type="button"
              onClick={() => { onChange(p.id); setQuery(`${p.projectNumber} - ${p.name}`); setOpen(false); }}
              className="block w-full px-3 py-2 text-left hover:bg-emerald-50"
            >
              <p className="font-semibold text-slate-800">{p.projectNumber} - {p.name}</p>
              <p className="text-xs text-slate-500">{p.client} • {p.division} • {p.status}</p>
            </button>
          )) : <p className="px-3 py-2 text-sm text-slate-500">No matching project</p>}
        </div>
      )}
    </div>
  );
}

// ─── SearchableCrewSelect ─────────────────────────────────────────────────────

export function SearchableCrewSelect({ value, onChange, crews }) {
  const containerRef = useRef(null);
  const current = crews.find((c) => c.id === value);
  const [query, setQuery] = useState(current ? getCrewDisplayName(current) : "");
  const [open, setOpen] = useState(false);

  useCloseDropdown(setOpen, containerRef);

  useEffect(() => {
    const selected = crews.find((c) => c.id === value);
    setQuery(selected ? getCrewDisplayName(selected) : "");
  }, [value, crews]);

  const filtered = crews.filter((c) =>
    `${c.crewName} ${c.foremanName} ${(c.specialty || []).join(" ")}`.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center rounded-xl border border-slate-300 px-3 py-2 focus-within:border-emerald-600">
        <Search size={16} className="mr-2 text-slate-400" />
        <input
          className="w-full outline-none"
          value={query}
          placeholder="Search crew..."
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); onChange(""); setOpen(true); }}
        />
      </div>
      {open && (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {filtered.length ? filtered.map((c) => (
            <button key={c.id} type="button"
              onClick={() => { onChange(c.id); setQuery(getCrewDisplayName(c)); setOpen(false); }}
              className="block w-full px-3 py-2 text-left hover:bg-emerald-50"
            >
              <p className="font-semibold text-slate-800">{getCrewDisplayName(c)}</p>
              <p className="text-xs text-slate-500">{(c.specialty || []).join(", ")}</p>
            </button>
          )) : <p className="px-3 py-2 text-sm text-slate-500">No matching crew</p>}
        </div>
      )}
    </div>
  );
}
