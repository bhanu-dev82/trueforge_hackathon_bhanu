const healthEl = document.getElementById('health');
const streamEl = document.getElementById('stream');
const runBtn = document.getElementById('run');
const gateEl = document.getElementById('gate');
const gateDetail = document.getElementById('gate-detail');
const allowBtn = document.getElementById('allow');
const denyBtn = document.getElementById('deny');

let currentRun = null;
let source = null;
let quotas = [];
const doneStages = new Set();

async function refreshHealth() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    healthEl.textContent = data.ok
      ? 'TrueForge is live'
      : 'TrueForge is down — run npx @truefoundry/trueforge@latest';
    healthEl.className = `status ${data.ok ? 'ok' : 'bad'}`;
    if (!runBtn.dataset.busy) runBtn.disabled = !data.ok;
  } catch {
    healthEl.textContent = 'Console cannot reach /api/health';
    healthEl.className = 'status bad';
    runBtn.disabled = true;
  }
}

async function loadQuotas() {
  try {
    const res = await fetch('/api/quotas');
    quotas = (await res.json()).models ?? [];
  } catch {
    quotas = [];
  }
}

function setStage(name) {
  for (const el of document.querySelectorAll('.checklist li')) {
    const stage = el.dataset.stage;
    el.classList.toggle('active', stage === name);
    el.classList.toggle('waiting', stage === name && name === 'approval');
    el.classList.toggle('done', doneStages.has(stage) && stage !== name);
  }
}

function append(text) {
  if (streamEl.dataset.empty === '1') {
    streamEl.textContent = '';
    streamEl.dataset.empty = '0';
  }
  streamEl.textContent += text;
  streamEl.scrollTop = streamEl.scrollHeight;
}

function showQuota(fqn) {
  document.getElementById('m-model').textContent = fqn ?? '—';
  const id = (fqn ?? '').split('/').pop();
  const q = quotas.find((m) => m.modelId === id);
  document.getElementById('m-quota').textContent = q
    ? `${new Intl.NumberFormat().format(q.rpm)} RPM · ${new Intl.NumberFormat().format(q.rpd)} RPD`
    : '—';
}

function onEvent(event) {
  if (event.kind === 'delta') {
    append(event.text ?? '');
    return;
  }
  if (event.kind === 'sandbox') {
    document.getElementById('m-sandbox').textContent = event.sandboxId ?? 'yes';
    doneStages.add('hunter');
    setStage('hunter');
    append(`\n[sandbox] ${event.sandboxId}\n`);
  }
  if (event.kind === 'thread') {
    const box = document.getElementById('m-threads');
    const prev = box.textContent === '—' ? [] : box.textContent.split(', ');
    if (event.title && !prev.includes(event.title)) prev.push(event.title);
    box.textContent = prev.join(', ') || '—';
    if (event.stage) {
      doneStages.add(event.stage);
      setStage(event.stage);
    }
    append(`\n[subagent] ${event.title}\n`);
  }
  if (event.kind === 'model') showQuota(event.modelFqn);
  if (event.kind === 'metrics' || event.kind === 'done') {
    if (event.text) document.getElementById('m-tokens').textContent = event.text;
    if (event.kind === 'done' && event.stage) setStage(event.stage);
  }
  if (event.kind === 'approval') {
    setStage('approval');
    gateDetail.textContent = event.text ?? 'A write tool is paused. Nothing is applied until you choose.';
    if (typeof gateEl.showModal === 'function' && !gateEl.open) gateEl.showModal();
    append(`\n[consent] ${event.text}\n`);
  }
  if (event.kind === 'error') {
    setStage('error');
    append(`\n[error] ${event.text}\n`);
  }
}

async function startRun() {
  streamEl.textContent = '';
  streamEl.dataset.empty = '0';
  if (gateEl.open) gateEl.close();
  document.getElementById('m-sandbox').textContent = '—';
  document.getElementById('m-threads').textContent = '—';
  document.getElementById('m-tokens').textContent = '—';
  doneStages.clear();
  setStage('hunter');
  runBtn.disabled = true;
  runBtn.dataset.busy = '1';
  runBtn.textContent = 'Reproducing…';

  const res = await fetch('/api/runs', { method: 'POST' });
  const data = await res.json();
  currentRun = data.id;
  if (source) source.close();
  source = new EventSource(`/api/runs/${currentRun}/events`);
  source.onmessage = (msg) => {
    const event = JSON.parse(msg.data);
    onEvent(event);
    if (event.kind === 'run.complete' || event.kind === 'error') {
      runBtn.disabled = false;
      delete runBtn.dataset.busy;
      runBtn.textContent = 'Reproduce the expired JWT';
    }
  };
}

async function decide(allow) {
  if (!currentRun) return;
  allowBtn.disabled = denyBtn.disabled = true;
  await fetch(`/api/runs/${currentRun}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ allow }),
  });
  if (gateEl.open) gateEl.close();
  allowBtn.disabled = denyBtn.disabled = false;
  if (allow) doneStages.add('approval');
}

runBtn.addEventListener('click', () => {
  startRun().catch((error) => {
    append(`\n${error}\n`);
    runBtn.disabled = false;
    delete runBtn.dataset.busy;
    runBtn.textContent = 'Reproduce the expired JWT';
  });
});
allowBtn.addEventListener('click', () => decide(true));
denyBtn.addEventListener('click', () => decide(false));

streamEl.dataset.empty = '1';
refreshHealth();
loadQuotas();
setInterval(refreshHealth, 5000);
