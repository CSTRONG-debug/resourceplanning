import React, { useState, useMemo } from 'react';

const GGC_GREEN = '#1f6e43';

const STATUS_STYLES = {
  pending:  { bg: '#fff7e6', fg: '#8a5a00', label: 'Pending' },
  approved: { bg: '#e8f5ee', fg: GGC_GREEN, label: 'Approved' },
  denied:   { bg: '#fdecea', fg: '#a3221b', label: 'Denied' },
};

function StatusPill({ status }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.pending;
  return (
    <span style={{
      background: s.bg, color: s.fg, fontSize: 12, fontWeight: 600,
      padding: '2px 10px', borderRadius: 999, whiteSpace: 'nowrap',
    }}>{s.label}</span>
  );
}

function projLabel(r) {
  const p = r.projects;
  if (!p) return 'Unknown project';
  return `${p.project_number ? p.project_number + ' — ' : ''}${p.name}`;
}

/* ---------------- PM: new request form ---------------- */
function NewRequestForm({ projects, crewSpecialties, supers, pmName, onSubmit }) {
  const empty = {
    project_id: '', request_type: 'crew', crew_specialty: '',
    superintendent: '', men_count: '', start_date: '', duration_weeks: '', notes: '',
  };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const needsCrew = form.request_type === 'crew' || form.request_type === 'both';
  const needsSuper = form.request_type === 'superintendent' || form.request_type === 'both';

  const submit = async () => {
    if (!form.project_id) { setErr('Pick a project first.'); return; }
    setBusy(true); setErr(null);
    try {
      await onSubmit({
        project_id: form.project_id,
        request_type: form.request_type,
        crew_specialty: needsCrew ? form.crew_specialty || null : null,
        superintendent: needsSuper ? form.superintendent || null : null,
        men_count: form.men_count ? Number(form.men_count) : 0,
        start_date: form.start_date || null,
        duration_weeks: form.duration_weeks ? Number(form.duration_weeks) : null,
        notes: form.notes || null,
      }, pmName);
      setForm(empty);
    } catch (e) { setErr(e.message || 'Could not submit request.'); }
    finally { setBusy(false); }
  };

  const field = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 };
  const input = {
    padding: '7px 9px', border: '1px solid #d6dbd8', borderRadius: 6,
    fontSize: 13, background: '#fff',
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
      <label style={field}>Project
        <select style={input} value={form.project_id} onChange={set('project_id')}>
          <option value="">Select…</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>
              {p.project_number ? p.project_number + ' — ' : ''}{p.name}
            </option>
          ))}
        </select>
      </label>

      <label style={field}>Request
        <select style={input} value={form.request_type} onChange={set('request_type')}>
          <option value="crew">Crew</option>
          <option value="superintendent">Superintendent</option>
          <option value="both">Crew + Super</option>
        </select>
      </label>

      {needsCrew && (
        <label style={field}>Crew type
          <input style={input} list="ggc-crew-specialties" value={form.crew_specialty}
                 onChange={set('crew_specialty')} placeholder="e.g. Pavers" />
          <datalist id="ggc-crew-specialties">
            {crewSpecialties.map(s => <option key={s} value={s} />)}
          </datalist>
        </label>
      )}

      {needsCrew && (
        <label style={field}>Men
          <input style={input} type="number" min="0" value={form.men_count}
                 onChange={set('men_count')} placeholder="0" />
        </label>
      )}

      {needsSuper && (
        <label style={field}>Superintendent
          <input style={input} list="ggc-supers" value={form.superintendent}
                 onChange={set('superintendent')} placeholder="Any / name" />
          <datalist id="ggc-supers">
            {supers.map(s => <option key={s} value={s} />)}
          </datalist>
        </label>
      )}

      <label style={field}>Start
        <input style={input} type="date" value={form.start_date} onChange={set('start_date')} />
      </label>

      <label style={field}>Weeks
        <input style={input} type="number" min="0" step="0.5" value={form.duration_weeks}
               onChange={set('duration_weeks')} placeholder="1" />
      </label>

      <label style={{ ...field, gridColumn: '1 / -1' }}>Notes
        <input style={input} value={form.notes} onChange={set('notes')}
               placeholder="Anything the office should know" />
      </label>

      {err && <div style={{ gridColumn: '1 / -1', color: '#a3221b', fontSize: 13 }}>{err}</div>}

      <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={submit} disabled={busy} style={{
          background: GGC_GREEN, color: '#fff', border: 'none', borderRadius: 6,
          padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          opacity: busy ? 0.6 : 1,
        }}>{busy ? 'Sending…' : 'Submit request'}</button>
      </div>
    </div>
  );
}

/* ---------------- Shared request row ---------------- */
function RequestRow({ r, role, onWithdraw, onResolve }) {
  const [busy, setBusy] = useState(false);
  const wrap = async (fn) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  const detail = [
    r.request_type === 'superintendent' ? 'Super' :
      r.request_type === 'both' ? 'Crew + Super' : 'Crew',
    r.crew_specialty,
    r.men_count ? `${r.men_count} men` : null,
    r.superintendent,
    r.start_date,
    r.duration_weeks ? `${r.duration_weeks} wk` : null,
  ].filter(Boolean).join(' · ');

  const canManage = (role === 'admin' || role === 'manager') && r.status === 'pending';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
      borderTop: '1px solid #eef1ef',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1a201d' }}>{projLabel(r)}</div>
        <div style={{ fontSize: 12, color: '#5d655f', marginTop: 2 }}>
          {detail}{(role !== 'pm') && r.requested_by_name ? ` · ${r.requested_by_name}` : ''}
        </div>
        {r.notes && <div style={{ fontSize: 12, color: '#858c86', marginTop: 2 }}>{r.notes}</div>}
      </div>

      <StatusPill status={r.status} />

      {canManage && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button disabled={busy} onClick={() => wrap(() => onResolve(r.id, 'approved'))}
            style={{ background: GGC_GREEN, color: '#fff', border: 'none', borderRadius: 6,
                     padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Approve
          </button>
          <button disabled={busy} onClick={() => wrap(() => onResolve(r.id, 'denied'))}
            style={{ background: '#fff', color: '#a3221b', border: '1px solid #e3b6b2',
                     borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Deny
          </button>
        </div>
      )}

      {role === 'pm' && r.status === 'pending' && (
        <button disabled={busy} onClick={() => wrap(() => onWithdraw(r.id))}
          style={{ background: 'transparent', color: '#858c86', border: '1px solid #d6dbd8',
                   borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
          Withdraw
        </button>
      )}
    </div>
  );
}

/* ---------------- Top-of-tab panel ---------------- */
export default function RequestPanel({
  role, pmName, requests, projects, crewSpecialties, supers,
  onCreate, onWithdraw, onResolve,
}) {
  const isPM = role === 'pm';
  const isOffice = role === 'admin' || role === 'manager';
  const [open, setOpen] = useState(isPM); // PMs land on the form open

  const pending = useMemo(() => requests.filter(r => r.status === 'pending'), [requests]);
  const resolved = useMemo(() => requests.filter(r => r.status !== 'pending'), [requests]);

  return (
    <section style={{
      border: '1px solid #e1e6e3', borderRadius: 10, background: '#fafbfa',
      marginBottom: 18, overflow: 'hidden',
    }}>
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', borderBottom: '1px solid #eef1ef', background: '#fff',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: GGC_GREEN }} />
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#1a201d' }}>
            {isOffice ? 'Crew & super requests' : 'Request a crew or super'}
          </h3>
          {pending.length > 0 && (
            <span style={{
              background: GGC_GREEN, color: '#fff', fontSize: 11, fontWeight: 700,
              borderRadius: 999, padding: '1px 8px',
            }}>{pending.length} pending</span>
          )}
        </div>
        {isPM && (
          <button onClick={() => setOpen(o => !o)} style={{
            background: open ? '#fff' : GGC_GREEN, color: open ? GGC_GREEN : '#fff',
            border: `1px solid ${GGC_GREEN}`, borderRadius: 6, padding: '6px 14px',
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>{open ? 'Close' : 'New request'}</button>
        )}
      </header>

      {isPM && open && (
        <div style={{ padding: 16, borderBottom: '1px solid #eef1ef', background: '#fff' }}>
          <NewRequestForm
            projects={projects} crewSpecialties={crewSpecialties} supers={supers}
            pmName={pmName} onSubmit={onCreate} />
        </div>
      )}

      <div>
        {requests.length === 0 ? (
          <div style={{ padding: '18px 16px', fontSize: 13, color: '#858c86' }}>
            {isOffice ? 'No requests yet. PM submissions will land here.'
                      : 'No requests yet. Use “New request” to ask the office for a crew or super.'}
          </div>
        ) : (
          <>
            {isOffice && pending.length > 0 && (
              <div style={{ padding: '8px 16px 0', fontSize: 11, fontWeight: 700,
                            letterSpacing: '.04em', color: '#858c86', textTransform: 'uppercase' }}>
                Needs action
              </div>
            )}
            {pending.map(r => (
              <RequestRow key={r.id} r={r} role={role}
                onWithdraw={onWithdraw} onResolve={onResolve} />
            ))}
            {resolved.length > 0 && (
              <div style={{ padding: '10px 16px 0', fontSize: 11, fontWeight: 700,
                            letterSpacing: '.04em', color: '#858c86', textTransform: 'uppercase' }}>
                Resolved
              </div>
            )}
            {resolved.map(r => (
              <RequestRow key={r.id} r={r} role={role}
                onWithdraw={onWithdraw} onResolve={onResolve} />
            ))}
          </>
        )}
      </div>
    </section>
  );
}
