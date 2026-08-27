const $ = (selector) => document.querySelector(selector);
const intake = $('#intake');
const runButton = $('#run');
const gate = $('#gate');
const denyButton = $('#deny');
const allowButton = $('#allow');
const terminalStates = new Set(['completed', 'blocked', 'failed']);
const phaseOrder = ['planning', 'reproducing', 'diagnosing', 'verifying', 'awaiting_approval', 'applying', 'completed'];
let snapshot = null;
let stream = null;
let lastEventId = 0;
let reconnectTimer = null;
let eventCache = [];

function text(selector, value) { const node = $(selector); if (node) node.textContent = value ?? '—'; }
function tone(status) {
  if (status === 'failed' || status === 'blocked') return 'bad';
  if (status === 'awaiting_approval' || status === 'applying') return 'warn';
  if (status === 'completed') return 'good';
  return 'neutral';
}
function showNotice(message) { const node = $('#notice'); node.textContent = message; node.hidden = !message; }
function setBusy(busy) { runButton.disabled = busy; runButton.setAttribute('aria-busy', String(busy)); runButton.textContent = busy ? 'Investigation running…' : 'Start investigation'; }
function setRole(name, state, label) { const node = document.querySelector(`[data-role="${name}"]`); if (!node) return; node.dataset.state = state; node.querySelector('em').textContent = label; }
function updateRoles(status) {
  for (const role of ['planner', 'executor', 'verifier']) setRole(role, '', 'Not started');
  setRole('operator', '', 'Standing by');
  const index = phaseOrder.indexOf(status);
  if (index >= 0) setRole('planner', index === 0 ? 'active' : 'done', index === 0 ? 'Bounding case' : 'Complete');
  if (index >= 1) setRole('executor', index <= 2 ? 'active' : 'done', index <= 2 ? 'Reproducing' : 'Complete');
  if (index >= 3) setRole('verifier', index === 3 ? 'active' : 'done', index === 3 ? 'Checking evidence' : 'Complete');
  if (status === 'awaiting_approval') setRole('operator', 'blocked', 'Decision required');
  if (status === 'applying') setRole('operator', 'active', 'Approved action');
  if (status === 'blocked') setRole('operator', 'blocked', 'Write denied');
  if (status === 'completed' && snapshot?.approval?.decision === 'allowed') setRole('operator', 'done', 'Action allowed');
  if (status === 'failed') {
    const active = document.querySelector('.roles li[data-state="active"]');
    if (active) { active.dataset.state = 'blocked'; active.querySelector('em').textContent = 'Failed'; }
  }
}
function evidenceClass(item) {
  if (item.kind === 'command' || item.kind === 'runtime' || item.kind === 'error') return 'observed';
  if (item.kind === 'plan' || item.kind === 'finding') return 'inferred';
  if (item.kind === 'approval') return 'proposed';
  if (item.kind === 'verification') return 'verified';
  return 'observed';
}
function renderEvidence(items = []) {
  const list = $('#evidence-list'); list.replaceChildren();
  if (!items.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'No structured evidence recorded yet.'; list.append(li); return; }
  for (const item of items) {
    const li = document.createElement('li');
    const meta = document.createElement('div'); meta.className = 'evidence-meta';
    const cls = document.createElement('span'); cls.className = 'evidence-class'; cls.dataset.class = evidenceClass(item); cls.textContent = cls.dataset.class;
    const actor = document.createElement('span'); actor.textContent = item.actor;
    const time = document.createElement('time'); time.dateTime = item.at; time.textContent = new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    meta.append(cls, actor, time);
    const body = document.createElement('div'); body.className = 'evidence-body';
    const heading = document.createElement('h3'); heading.textContent = item.summary; body.append(heading);
    if (item.detail) { const detail = document.createElement('p'); detail.textContent = item.detail; body.append(detail); }
    if (item.command) { const code = document.createElement('code'); code.textContent = `${item.command} → exit ${item.exitCode ?? 'unknown'}${item.durationMs != null ? ` · ${item.durationMs}ms` : ''}`; body.append(code); }
    li.append(meta, body); list.append(li);
  }
}
function eventDescription(event) {
  if (event.kind === 'repro') return `${event.command ?? 'test'} → exit ${event.exitCode ?? 'unknown'}`;
  if (event.kind === 'thread') return event.title ?? 'thread created';
  if (event.kind === 'sandbox') return `sandbox ${event.sandboxId ?? 'created'}`;
  if (event.kind === 'run.complete') return `${event.mode ?? ''} · ${event.status ?? ''}`;
  return event.text ?? event.status ?? '';
}
function renderEvents(events = []) {
  eventCache = events;
  const list = $('#events'); list.replaceChildren();
  for (const event of events) {
    const li = document.createElement('li');
    const id = document.createElement('span'); id.textContent = `#${event.id}`;
    const kind = document.createElement('b'); kind.textContent = event.kind;
    const detail = document.createElement('code'); detail.textContent = eventDescription(event);
    li.append(id, kind, detail); list.append(li);
  }
  lastEventId = Math.max(lastEventId, ...events.map((event) => Number(event.id) || 0), 0);
}
function renderRuntime(runtime) {
  const list = $('#runtime'); list.replaceChildren();
  const rows = [['Mode', runtime?.mode ?? 'Not selected'], ['Isolation', runtime?.isolated == null ? 'Unknown' : runtime.isolated ? 'Yes' : 'No — controlled fallback'], ['Detail', runtime?.detail ?? 'Starts when investigation begins']];
  for (const [key, value] of rows) { const row = document.createElement('div'); const dt = document.createElement('dt'); const dd = document.createElement('dd'); dt.textContent = key; dd.textContent = value; row.append(dt, dd); list.append(row); }
}
function fillList(selector, values, empty) {
  const list = $(selector); list.replaceChildren();
  for (const value of values?.length ? values : [empty]) { const li = document.createElement('li'); li.textContent = value; list.append(li); }
}
function renderApproval(approval) {
  if (!approval) return;
  text('#approval-action', approval.action); text('#approval-tool', approval.tool); text('#approval-target', approval.target); text('#approval-reversible', approval.reversible ? 'Yes' : 'Not stated');
  fillList('#approval-files', approval.files, 'No files supplied by the tool.');
  text('#approval-diff', approval.diff || 'No diff supplied by the tool.');
  fillList('#approval-tests', approval.testEvidence?.map((test) => `${test.command} → exit ${test.exitCode} · ${test.summary}`), 'No test evidence supplied.');
  text('#gate-summary', `${approval.summary} Nothing has been applied. Deny is focused by default.`);
  if (snapshot?.status === 'awaiting_approval' && !gate.open) { gate.showModal(); requestAnimationFrame(() => denyButton.focus()); }
}
function renderOutcome(data) {
  const node = $('#outcome');
  if (!data.outcome) { node.hidden = true; return; }
  node.hidden = false; node.dataset.tone = tone(data.status); node.replaceChildren();
  const heading = document.createElement('h3');
  const labels = { verified: 'Investigation verified', blocked: 'Write blocked by operator', failed: 'Investigation failed', awaiting_approval: 'Approval required' };
  heading.textContent = labels[data.outcome.disposition] ?? 'Outcome';
  const para = document.createElement('p'); para.textContent = data.outcome.summary;
  node.append(heading, para);
}
function renderSnapshot(data, { restoreForm = false } = {}) {
  snapshot = data; localStorage.setItem('trueforge:lastRun', data.id);
  text('#run-id', data.id); text('#run-status', data.status.replaceAll('_', ' ').toUpperCase()); $('#run-status').dataset.tone = tone(data.status);
  if (restoreForm && data.intake) for (const [key, value] of Object.entries(data.intake)) { const field = intake.elements.namedItem(key); if (field && typeof value === 'string') field.value = value; }
  text('#source-label', data.intake?.source === 'sample' ? 'SAMPLE INPUT' : 'OPERATOR INPUT');
  renderRuntime(data.runtime); renderEvidence(data.evidence); renderEvents(data.events); updateRoles(data.status); renderOutcome(data); renderApproval(data.approval);
  $('#copy').disabled = $('#download').disabled = false;
  setBusy(!terminalStates.has(data.status) && data.status !== 'awaiting_approval');
}
async function fetchSnapshot(runId, options) {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
  if (!response.ok) throw new Error(response.status === 404 ? 'The saved case file is no longer available.' : `Snapshot request failed (${response.status}).`);
  const data = await response.json(); renderSnapshot(data, options); return data;
}
function connectEvents(runId) {
  if (stream) stream.close(); clearTimeout(reconnectTimer);
  const after = lastEventId ? `?after=${lastEventId}` : '';
  stream = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events${after}`);
  text('#stream-state', lastEventId ? `reconnecting after event ${lastEventId}` : 'connecting');
  stream.onopen = () => text('#stream-state', 'live');
  stream.onmessage = async (message) => {
    const event = JSON.parse(message.data); lastEventId = Math.max(lastEventId, Number(message.lastEventId || event.id) || 0);
    if (!eventCache.some((item) => item.id === event.id)) { eventCache.push(event); renderEvents(eventCache); }
    await fetchSnapshot(runId).catch((error) => showNotice(error.message));
    if (event.kind === 'run.complete' || event.kind === 'error') { stream.close(); text('#stream-state', 'case persisted'); }
  };
  stream.onerror = () => {
    stream.close(); text('#stream-state', `connection lost after event ${lastEventId}`);
    if (!terminalStates.has(snapshot?.status)) reconnectTimer = setTimeout(() => connectEvents(runId), 1400);
  };
}
async function loadCapabilities() {
  try {
    const [health, isolation] = await Promise.all([fetch('/api/health').then((r) => r.json()), fetch('/api/isolation').then((r) => r.json())]);
    const enhanced = health.mode === 'trueforge-enhanced';
    const capabilities = [
      ['TrueForge', enhanced ? 'reachable' : 'unavailable · local-only mode', enhanced ? 'on' : 'off'],
      ['Local runtime', 'ready · container/worktree/process selection', 'on'],
      ['Sandbox', health.capabilities?.sandbox ? 'configured · activity shown only when emitted' : 'not configured or unavailable', health.capabilities?.sandbox ? 'on' : 'off'],
      ['GitHub', health.capabilities?.github ? 'configured · every write is gated' : 'not configured or unavailable', health.capabilities?.github ? 'on' : 'off'],
      ['Research', health.capabilities?.research ? 'configured · optional' : 'not configured or unavailable', health.capabilities?.research ? 'on' : 'off'],
    ];
    const list = $('#capabilities'); list.replaceChildren();
    for (const [name, detail, state] of capabilities) { const li = document.createElement('li'); li.dataset.state = state; li.textContent = `${name}: ${detail}`; list.append(li); }
    text('#connection-note', health.note); runButton.disabled = false;
    if (!enhanced) text('#connection-note', 'LOCAL-ONLY: no model, subagent, GitHub, research, or sandbox activity will be claimed.');
    $('#runtime').title = isolation.note ?? '';
  } catch {
    $('#capabilities').innerHTML = '<li data-state="off">Harness API: unreachable</li>';
    text('#connection-note', 'The local console cannot reach its backend.'); runButton.disabled = true;
  }
}
async function start(event) {
  event.preventDefault(); showNotice(''); if (!intake.reportValidity()) return;
  if (stream) stream.close(); lastEventId = 0; eventCache = []; setBusy(true);
  const payload = Object.fromEntries(new FormData(intake).entries());
  const response = await fetch('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Could not start (${response.status}).`);
  if (data.snapshot) renderSnapshot(data.snapshot);
  else await fetchSnapshot(data.id);
  connectEvents(data.id); document.querySelector('.operations').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
async function decide(allow) {
  if (!snapshot?.id) return; allowButton.disabled = denyButton.disabled = true;
  try {
    const response = await fetch(`/api/runs/${encodeURIComponent(snapshot.id)}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allow }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? `Decision failed (${response.status}).`);
    gate.close(); renderSnapshot(data.snapshot); showNotice(allow ? 'Action approved and recorded in the durable case file.' : 'Action blocked and recorded in the durable case file.');
  } catch (error) { showNotice(error.message); }
  finally { allowButton.disabled = denyButton.disabled = false; }
}
function caseJson() { return JSON.stringify(snapshot, null, 2); }
intake.addEventListener('input', () => text('#source-label', 'EDITED INPUT'));
intake.addEventListener('submit', (event) => start(event).catch((error) => { showNotice(error.message); setBusy(false); }));
denyButton.addEventListener('click', () => decide(false)); allowButton.addEventListener('click', () => decide(true));
gate.addEventListener('cancel', (event) => { event.preventDefault(); denyButton.focus(); });
$('#copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(caseJson()); showNotice('Case file copied to clipboard.'); } catch { showNotice('Clipboard permission was denied. Use Download JSON instead.'); } });
$('#download').addEventListener('click', () => { const url = URL.createObjectURL(new Blob([caseJson()], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `${snapshot.id}.case.json`; link.click(); URL.revokeObjectURL(url); });

await loadCapabilities();
const savedRun = localStorage.getItem('trueforge:lastRun');
if (savedRun) {
  try { const data = await fetchSnapshot(savedRun, { restoreForm: true }); if (!terminalStates.has(data.status) && data.status !== 'awaiting_approval') connectEvents(savedRun); else text('#stream-state', 'restored from durable snapshot'); }
  catch (error) { localStorage.removeItem('trueforge:lastRun'); showNotice(error.message); }
}
