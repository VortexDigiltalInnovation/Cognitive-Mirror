// COGNITIVE CORE OS v17.1 ULTRA ENTERPRISE - AUTONOMOUS AI & APP ENGINE
'use strict';

const STORAGE_KEY = 'cognitive_core_state';
const CATEGORIES = ['Liquidità', 'Conti Deposito', 'Azionario'];
const CHART_COLORS = ['#14b8a6', '#3b82f6', '#10b981', '#f59e0b', '#a855f7', '#ef4444'];
const DEFAULT_WORKER_URL = 'https://trenolive-proxy.fabiomirra79.workers.dev/';
const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';

const DEFAULT_STATE = {
  aiName: 'Jarvis',
  geminiApiKey: '',
  geminiModel: DEFAULT_GEMINI_MODEL,
  workerUrl: DEFAULT_WORKER_URL,
  workerSecret: '',
  sunpowerMode: 'auto',
  autopilot: true,
  ttsEnabled: true,
  selectedVoiceURI: null,
  assets: [
    { id: '1', name: 'Conto Corrente Liquidità', category: 'Liquidità', value: 5000 },
    { id: '2', name: 'Conto Deposito Vincolato', category: 'Conti Deposito', value: 15000 },
    { id: '3', name: 'Portafoglio ETF Globale', category: 'Azionario', value: 25000 }
  ],
  fidelityCards: [
    { id: 'c1', name: 'Supermercato Coop', code: '2048593021840', format: 'EAN13' },
    { id: 'c2', name: 'Carta Fedeltà Sport', code: '049281938', format: 'CODE128' }
  ],
  credentials: [
    { id: 'k1', title: 'Cloudflare Worker Console', user: 'admin@fabiomirra.dev', category: 'Dev' }
  ]
};

/* ---------- UTILITY ---------- */
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function cloneDefaults() { return JSON.parse(JSON.stringify(DEFAULT_STATE)); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function refreshIcons() { if (window.lucide) window.lucide.createIcons(); }

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

function stripAccents(s) { return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }

function formatEUR(n) {
  return '€ ' + (Number(n) || 0).toLocaleString('it-IT', { maximumFractionDigits: 2 });
}

// Accetta "1500", "1500.5", "1500,5", "1.500,50", "1.500", "€ 1 500"
function parseAmount(str) {
  if (str == null) return NaN;
  let s = String(str).trim().replace(/[€\s]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? parseFloat(s) : NaN;
}

function normalizeCategory(input) {
  const wanted = stripAccents(input);
  return CATEGORIES.find(c => stripAccents(c) === wanted) || null;
}

/* ---------- STATO ---------- */
function normalizeState(raw) {
  const base = cloneDefaults();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const out = Object.assign(base, raw);
  const cleanArr = (v, fallback) => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : fallback);

  out.assets = cleanArr(out.assets, []).map(a => ({
    id: String(a.id ?? uid()),
    name: String(a.name ?? ''),
    category: String(a.category ?? 'Liquidità'),
    value: Number.isFinite(Number(a.value)) ? Number(a.value) : 0
  }));
  out.fidelityCards = cleanArr(out.fidelityCards, []).map(c => ({
    id: String(c.id ?? uid()),
    name: String(c.name ?? ''),
    code: String(c.code ?? ''),
    format: String(c.format ?? 'CODE128')
  }));
  out.credentials = cleanArr(out.credentials, []).map(c => ({
    id: String(c.id ?? uid()),
    title: String(c.title ?? ''),
    user: String(c.user ?? ''),
    category: String(c.category ?? 'Generale')
  }));
  out.aiName = String(out.aiName || 'Jarvis');
  out.geminiApiKey = String(out.geminiApiKey || '');
  out.geminiModel = String(out.geminiModel || DEFAULT_GEMINI_MODEL);
  out.workerUrl = String(out.workerUrl || DEFAULT_WORKER_URL);
  out.workerSecret = String(out.workerSecret || '');
  out.ttsEnabled = out.ttsEnabled !== false;
  out.selectedVoiceURI = out.selectedVoiceURI || null;
  delete out.selectedVoiceIndex; // sostituito da selectedVoiceURI
  return out;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeState(JSON.parse(raw)) : cloneDefaults();
  } catch (e) {
    console.warn('Stato locale non leggibile, uso i valori predefiniti:', e);
    return cloneDefaults();
  }
}

let appState = loadState();

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
  } catch (e) {
    console.warn('Salvataggio non riuscito:', e);
    alert('Impossibile salvare i dati (spazio esaurito o storage bloccato dal browser).');
  }
}

/* ---------- AVVIO ---------- */
document.addEventListener('DOMContentLoaded', () => {
  refreshIcons();
  applySettingsToUI();
  initChart();
  renderAssets();
  renderFidelityCards();
  renderCredentials();
  initSpeechEngine();

  window.addEventListener('online', updateNetworkStatus);
  window.addEventListener('offline', updateNetworkStatus);
  updateNetworkStatus();

  document.addEventListener('keydown', handleGlobalKeys);
  const cmdInput = document.getElementById('cmd-input');
  if (cmdInput) cmdInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); runFirstCmdResult(); }
  });
  ['barcode-modal', 'cmd-palette'].forEach(id => {
    const m = document.getElementById(id);
    if (m) m.addEventListener('click', e => {
      if (e.target !== m) return;
      if (id === 'barcode-modal') closeBarcodeModal(); else closeCmdPalette();
    });
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.log('SW error:', err));
  }
});

function applySettingsToUI() {
  const set = (id, v) => { const n = document.getElementById(id); if (n) n.value = v; };
  set('gemini-key-setting', appState.geminiApiKey);
  set('gemini-model-setting', appState.geminiModel);
  set('ai-name-setting', appState.aiName);
  set('worker-url-setting', appState.workerUrl);
  set('worker-secret-setting', appState.workerSecret);
  const title = document.getElementById('ai-drawer-title');
  if (title) title.innerText = `${appState.aiName} AI Assistant`;
  const tts = document.getElementById('tts-toggle-btn');
  if (tts) tts.innerText = `TTS: ${appState.ttsEnabled ? 'ON' : 'OFF'}`;
}

function updateNetworkStatus() {
  const badge = document.getElementById('network-status-badge');
  if (!badge) return;
  if (navigator.onLine) {
    badge.className = 'hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-mono bg-emerald-500/10 border-emerald-500/30 text-emerald-400';
    badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span><span>Online</span>';
  } else {
    badge.className = 'hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-mono bg-red-500/10 border-red-500/30 text-red-400';
    badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-red-400"></span><span>Offline (Local-First)</span>';
  }
}

function switchTab(tabId) {
  const section = document.getElementById(`tab-${tabId}`);
  if (!section) return;
  document.querySelectorAll('.tab-content').forEach(n => n.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('text-emerald-400', 'border-emerald-400');
    btn.classList.add('text-slate-400', 'border-transparent');
  });
  section.classList.remove('hidden');
  const btn = document.getElementById(`tab-btn-${tabId}`);
  if (btn) {
    btn.classList.add('text-emerald-400', 'border-emerald-400');
    btn.classList.remove('text-slate-400', 'border-transparent');
  }
  if (tabId === 'finance' && allocationChartInstance) allocationChartInstance.resize();
}

/* ---------- FINANZA & ASSETS ---------- */
let allocationChartInstance = null;

function computeTotals() {
  let net = 0, liq = 0, inv = 0;
  appState.assets.forEach(a => {
    net += a.value;
    if (a.category === 'Liquidità') liq += a.value; else inv += a.value;
  });
  return { net, liq, inv };
}

function renderAssets() {
  const tbody = document.getElementById('asset-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (appState.assets.length === 0) {
    const tr = el('tr');
    const td = el('td', 'p-3 text-center text-slate-500', 'Nessun asset registrato');
    td.colSpan = 4;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  appState.assets.forEach(asset => {
    const tr = el('tr', 'hover:bg-slate-900/50');
    tr.appendChild(el('td', 'p-3 font-semibold text-slate-200', asset.name));
    const catTd = el('td', 'p-3');
    catTd.appendChild(el('span', 'px-2 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400', asset.category));
    tr.appendChild(catTd);
    tr.appendChild(el('td', 'p-3 text-right font-mono font-bold text-emerald-400', formatEUR(asset.value)));
    const actTd = el('td', 'p-3 text-center');
    const del = el('button', 'text-red-400 hover:text-red-300');
    del.setAttribute('aria-label', `Elimina ${asset.name}`);
    del.innerHTML = '<i data-lucide="trash-2" class="w-3.5 h-3.5"></i>';
    del.addEventListener('click', () => deleteAsset(asset.id));
    actTd.appendChild(del);
    tr.appendChild(actTd);
    tbody.appendChild(tr);
  });

  const t = computeTotals();
  document.getElementById('total-net-worth').innerText = formatEUR(t.net);
  document.getElementById('total-liquidity').innerText = formatEUR(t.liq);
  document.getElementById('total-invested').innerText = formatEUR(t.inv);
  refreshIcons();
  updateAllocationChart();
}

function initChart() {
  const ctx = document.getElementById('allocationChart');
  if (!ctx || typeof Chart === 'undefined') return;
  Chart.defaults.color = '#cbd5e1';
  allocationChartInstance = new Chart(ctx.getContext('2d'), {
    type: 'doughnut',
    data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderWidth: 0 }] },
    options: {
      responsive: true,
      plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } }
    }
  });
}

function updateAllocationChart() {
  if (!allocationChartInstance) return;
  const extra = [...new Set(appState.assets.map(a => a.category))].filter(c => !CATEGORIES.includes(c));
  const cats = [...CATEGORIES, ...extra];
  const totals = cats.map(cat => appState.assets.filter(a => a.category === cat).reduce((s, a) => s + a.value, 0));
  const ds = allocationChartInstance.data.datasets[0];
  allocationChartInstance.data.labels = cats;
  ds.data = totals;
  ds.backgroundColor = cats.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);
  allocationChartInstance.update();
}

function addNewAssetPrompt() {
  const name = prompt('Nome Asset:');
  if (name === null) return;
  if (!name.trim()) { alert('Il nome è obbligatorio.'); return; }
  const valueStr = prompt('Valore (€):');
  if (valueStr === null) return;
  const value = parseAmount(valueStr);
  if (!Number.isFinite(value)) { alert('Valore non valido. Esempi: 1500 oppure 1.500,50'); return; }
  const catStr = prompt(`Categoria (${CATEGORIES.join(' / ')}):`, 'Liquidità');
  if (catStr === null) return;
  const category = normalizeCategory(catStr);
  if (!category) { alert(`Categoria non riconosciuta. Usa una tra: ${CATEGORIES.join(', ')}.`); return; }
  appState.assets.push({ id: uid(), name: name.trim(), value, category });
  saveState();
  renderAssets();
}

function deleteAsset(id) {
  const a = appState.assets.find(x => x.id === id);
  if (!a || !confirm(`Eliminare "${a.name}"?`)) return;
  appState.assets = appState.assets.filter(x => x.id !== id);
  saveState();
  renderAssets();
}

/* ---------- FEDELTÀ & BARCODE ---------- */
function detectBarcodeFormat(code) {
  if (/^\d{13}$/.test(code)) return 'EAN13';
  if (/^\d{12}$/.test(code)) return 'UPC';
  if (/^\d{8}$/.test(code)) return 'EAN8';
  return 'CODE128';
}

// Disegna il barcode; se il formato non è valido (es. checksum EAN errato) ripiega su CODE128.
// Restituisce il formato usato, oppure null se impossibile.
function drawBarcode(target, code, format, opts) {
  if (typeof JsBarcode === 'undefined') return null;
  try {
    JsBarcode(target, code, Object.assign({ format }, opts));
    return format;
  } catch (e) {
    if (format === 'CODE128') return null;
    try {
      JsBarcode(target, code, Object.assign({}, opts, { format: 'CODE128' }));
      return 'CODE128';
    } catch (e2) { return null; }
  }
}

function newSvg() { return document.createElementNS('http://www.w3.org/2000/svg', 'svg'); }

function renderFidelityCards() {
  const container = document.getElementById('fidelity-grid');
  if (!container) return;
  container.innerHTML = '';

  if (appState.fidelityCards.length === 0) {
    container.appendChild(el('p', 'text-xs text-slate-500 col-span-full', 'Nessuna carta salvata'));
    return;
  }

  appState.fidelityCards.forEach(card => {
    const div = el('div', 'p-3 rounded-lg bg-slate-900 border border-slate-800 cursor-pointer hover:border-emerald-500/40');
    div.addEventListener('click', () => openBarcodeModal(card));

    const head = el('div', 'flex justify-between items-start mb-2 gap-2');
    head.appendChild(el('span', 'font-bold text-xs text-slate-200', card.name));
    const right = el('div', 'flex items-center gap-1.5 shrink-0');
    const badge = el('span', 'text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono', card.format);
    const del = el('button', 'text-red-400 hover:text-red-300');
    del.setAttribute('aria-label', `Elimina ${card.name}`);
    del.innerHTML = '<i data-lucide="trash-2" class="w-3.5 h-3.5"></i>';
    del.addEventListener('click', e => { e.stopPropagation(); deleteCard(card.id); });
    right.append(badge, del);
    head.appendChild(right);

    const wrap = el('div', 'bg-white p-2 rounded flex justify-center');
    const svg = newSvg();
    svg.setAttribute('class', 'max-h-12 w-full');
    wrap.appendChild(svg);
    div.append(head, wrap);
    container.appendChild(div);

    const used = drawBarcode(svg, card.code, card.format, { displayValue: false, height: 30 });
    if (used) badge.textContent = used;
    else { wrap.innerHTML = ''; wrap.appendChild(el('span', 'text-[10px] font-mono text-slate-700', card.code)); }
  });
  refreshIcons();
}

function addNewCardPrompt() {
  const name = prompt('Nome Carta Fedeltà:');
  if (name === null) return;
  if (!name.trim()) { alert('Il nome è obbligatorio.'); return; }
  const codeRaw = prompt('Codice a barre:');
  if (codeRaw === null) return;
  const code = codeRaw.replace(/\s+/g, '');
  if (!code) { alert('Il codice è obbligatorio.'); return; }

  const format = drawBarcode(newSvg(), code, detectBarcodeFormat(code), {});
  if (!format) { alert('Codice non valido: usa solo caratteri ASCII (numeri e lettere).'); return; }
  appState.fidelityCards.push({ id: uid(), name: name.trim(), code, format });
  saveState();
  renderFidelityCards();
}

function deleteCard(id) {
  const c = appState.fidelityCards.find(x => x.id === id);
  if (!c || !confirm(`Eliminare la carta "${c.name}"?`)) return;
  appState.fidelityCards = appState.fidelityCards.filter(x => x.id !== id);
  saveState();
  renderFidelityCards();
}

function openBarcodeModal(card) {
  document.getElementById('modal-card-title').innerText = card.name;
  document.getElementById('modal-card-code').innerText = card.code;
  const svg = document.getElementById('modal-barcode-svg');
  svg.innerHTML = '';
  const used = drawBarcode(svg, card.code, card.format, { displayValue: true, height: 80 });
  if (!used) document.getElementById('modal-card-code').innerText = `${card.code} (barcode non generabile)`;
  document.getElementById('barcode-modal').classList.remove('hidden');
}

function closeBarcodeModal() {
  document.getElementById('barcode-modal').classList.add('hidden');
}

/* ---------- CREDENZIALI ---------- */
function renderCredentials() {
  const container = document.getElementById('credentials-list');
  if (!container) return;
  const searchEl = document.getElementById('vault-search');
  const query = searchEl ? searchEl.value.toLowerCase() : '';
  container.innerHTML = '';

  const list = appState.credentials.filter(c => c.title.toLowerCase().includes(query));
  if (list.length === 0) {
    container.appendChild(el('p', 'text-xs text-slate-500', query ? 'Nessun risultato' : 'Nessuna credenziale salvata'));
    return;
  }
  list.forEach(c => {
    const div = el('div', 'p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center text-xs');
    const info = el('div');
    info.appendChild(el('span', 'font-bold text-slate-200', c.title));
    info.appendChild(document.createElement('br'));
    info.appendChild(el('span', 'text-[10px] text-slate-400', c.user));
    const del = el('button', 'text-red-400 hover:text-red-300');
    del.setAttribute('aria-label', `Elimina ${c.title}`);
    del.innerHTML = '<i data-lucide="trash-2" class="w-3.5 h-3.5"></i>';
    del.addEventListener('click', () => deleteCredential(c.id));
    div.append(info, del);
    container.appendChild(div);
  });
  refreshIcons();
}

function addNewCredentialPrompt() {
  const title = prompt('Titolo Credenziale:');
  if (title === null) return;
  const user = prompt('Username / Email:');
  if (user === null) return;
  if (!title.trim() || !user.trim()) { alert('Titolo e username sono obbligatori.'); return; }
  appState.credentials.push({ id: uid(), title: title.trim(), user: user.trim(), category: 'Generale' });
  saveState();
  renderCredentials();
}

function deleteCredential(id) {
  const c = appState.credentials.find(x => x.id === id);
  if (!c || !confirm(`Eliminare "${c.title}"?`)) return;
  appState.credentials = appState.credentials.filter(x => x.id !== id);
  saveState();
  renderCredentials();
}

/* ---------- TRENO LIVE (via Worker Cloudflare) ---------- */
function fmtTime(ms) {
  return typeof ms === 'number' && ms > 0
    ? new Date(ms).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
    : '—';
}

async function fetchTrainData() {
  const resultsDiv = document.getElementById('train-results');
  const trainNum = (document.getElementById('train-num-input').value || '').replace(/\D/g, '');
  if (!trainNum) {
    resultsDiv.innerHTML = '<p class="text-amber-400">Inserisci un numero di treno valido (solo cifre).</p>';
    return;
  }
  resultsDiv.innerHTML = '<p class="text-emerald-400 animate-pulse">Connessione al Worker Cloudflare in corso...</p>';

  let endpoint;
  try {
    endpoint = new URL((appState.workerUrl || DEFAULT_WORKER_URL).trim());
    endpoint.searchParams.set('treno', trainNum);
  } catch (e) {
    resultsDiv.innerHTML = '<p class="text-amber-400">URL del Worker non valido: controllalo nelle Impostazioni.</p>';
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(endpoint.toString(), { headers: { Accept: 'application/json' }, signal: controller.signal });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.success) {
      throw new Error((data && data.error) || `HTTP ${res.status}`);
    }
    renderTrainResult(trainNum, data);
  } catch (err) {
    const msg = err.name === 'AbortError' ? 'Timeout: il Worker non ha risposto entro 12 secondi' : err.message;
    resultsDiv.innerHTML = `
      <div class="p-3 bg-amber-950/40 rounded border border-amber-500/30 space-y-1">
        <div class="text-amber-400 font-bold flex items-center gap-1.5"><i data-lucide="alert-triangle" class="w-4 h-4"></i> Dati del treno #${esc(trainNum)} non disponibili</div>
        <p class="text-slate-300 text-[11px]">Dettaglio: ${esc(msg)}. Nessuna informazione simulata viene mostrata: riprova più tardi o verifica il Worker.</p>
      </div>`;
    refreshIcons();
  } finally {
    clearTimeout(timeoutId);
  }
}

function renderTrainResult(trainNum, d) {
  const delay = Number(d.ritardo);
  const delayTxt = Number.isFinite(delay) ? (delay > 0 ? `+${delay} min` : 'In orario') : '—';
  const stops = Array.isArray(d.fermate) ? d.fermate : [];
  const rows = stops.slice(0, 20).map(f => `
    <tr class="border-t border-slate-800">
      <td class="py-1 pr-2 text-slate-200">${esc(f.stazione)}</td>
      <td class="py-1 pr-2 text-right">${fmtTime(f.programmata)}</td>
      <td class="py-1 text-right text-emerald-400">${fmtTime(f.effettiva)}</td>
    </tr>`).join('');

  document.getElementById('train-results').innerHTML = `
    <div class="p-3 bg-slate-900 rounded border border-emerald-500/30 space-y-2 font-mono">
      <div class="text-emerald-400 font-bold">Treno ${esc(d.categoria || '')} #${esc(trainNum)}</div>
      <div class="text-slate-300 text-[11px]">${esc(d.origine || '?')} → ${esc(d.destinazione || '?')}</div>
      <div class="text-slate-300 text-[11px]">Stato: <span class="${delay > 0 ? 'text-amber-400' : 'text-emerald-400'}">${esc(delayTxt)}</span>
        • Ultimo rilevamento: ${esc(d.stazioneUltimoRilevamento || '—')} ${fmtTime(d.oraUltimoRilevamento)}</div>
      ${rows ? `<div class="overflow-x-auto"><table class="w-full text-[11px] text-slate-400">
        <thead><tr class="text-slate-500"><th class="text-left font-normal">Fermata</th><th class="text-right font-normal">Prog.</th><th class="text-right font-normal">Eff.</th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : ''}
    </div>`;
}

/* ---------- AI: CHAT, GEMINI, COMANDI LOCALI ---------- */
let isSending = false;
const chatHistory = []; // solo in memoria: [{role:'user'|'model', parts:[{text}]}]

function formatChatText(t) {
  return esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
}

function addChatBubble(text, kind) {
  const body = document.getElementById('ai-chat-body');
  const cls = {
    user: 'p-2.5 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-200 text-right font-medium',
    ai: 'p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-200',
    loading: 'p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 animate-pulse'
  }[kind];
  const div = el('div', cls);
  div.innerHTML = formatChatText(text);
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
  return div;
}

async function sendAIMessage() {
  if (isSending) return;
  const input = document.getElementById('ai-input');
  const msg = input.value.trim();
  if (!msg) return;

  isSending = true;
  input.value = '';
  addChatBubble(msg, 'user');
  const loading = addChatBubble(`${appState.aiName} sta elaborando la richiesta...`, 'loading');

  let reply;
  try {
    if (appState.geminiApiKey && navigator.onLine) {
      try {
        reply = await callGeminiAPI(msg);
      } catch (err) {
        reply = `${processLocalCommand(msg)}\n\n(Gemini non disponibile: ${err.message}. Risposta generata in locale.)`;
      }
    } else {
      await sleep(300);
      reply = processLocalCommand(msg);
    }
  } finally {
    loading.remove();
    isSending = false;
  }
  addChatBubble(reply, 'ai');
  speakText(reply);
}

function processLocalCommand(msg) {
  const lower = stripAccents(msg);
  const t = computeTotals();
  const txt = id => (document.getElementById(id) || {}).textContent || '—';

  if (/diagnosi|ottimizzazione/.test(lower)) {
    return `Diagnosi completata (telemetria dimostrativa): produzione FV ${txt('telemetry-pv')} kW, batteria ${txt('telemetry-battery')}%, carico casa ${txt('telemetry-load')} kW.\n` +
      `Patrimonio netto ${formatEUR(t.net)}, di cui liquidità ${formatEUR(t.liq)} e investito ${formatEUR(t.inv)}.\n` +
      `Modalità inverter: ${appState.sunpowerMode}.`;
  }
  if (/sunpower|fotovoltaic|inverter|impianto/.test(lower)) {
    if (/\bauto\b|autoconsumo/.test(lower)) {
      appState.sunpowerMode = 'auto';
      saveState();
      return "Ho impostato l'inverter fotovoltaico in modalità Auto (Autoconsumo Ottimizzato).";
    }
    return `Modalità attuale dell'inverter: ${appState.sunpowerMode}. Scrivi "imposta il fotovoltaico in modalità Auto" per cambiarla.`;
  }
  if (/investit/.test(lower)) return `Il capitale investito registrato è pari a ${formatEUR(t.inv)}.`;
  if (/liquidit/.test(lower)) return `La liquidità immediata registrata è pari a ${formatEUR(t.liq)}.`;
  if (/finanza|patrimonio|totale/.test(lower)) return `Il tuo patrimonio netto totale registrato è pari a ${formatEUR(t.net)}.`;

  return `Sono ${appState.aiName}. In modalità locale capisco: diagnosi, patrimonio/liquidità/investito e modalità inverter. Per domande libere inserisci la Gemini API Key nelle Impostazioni.`;
}

async function callGeminiAPI(promptText) {
  const t = computeTotals();
  const systemPrompt = `Sei l'assistente AI strategico dell'ecosistema Cognitive Core OS. Rispondi in italiano in modo chiaro, diretto e conciso. ` +
    `Patrimonio netto: €${t.net} (liquidità €${t.liq}, investito €${t.inv}). Modalità fotovoltaico: ${appState.sunpowerMode}.`;
  const model = (appState.geminiModel || DEFAULT_GEMINI_MODEL).trim();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': appState.geminiApiKey },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [...chatHistory.slice(-10), { role: 'user', parts: [{ text: promptText }] }]
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data.error && data.error.message) || `HTTP ${res.status}`);

    const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    const text = Array.isArray(parts) ? parts.map(p => p.text || '').join('').trim() : '';
    if (!text) throw new Error('risposta vuota o bloccata dai filtri');

    chatHistory.push({ role: 'user', parts: [{ text: promptText }] }, { role: 'model', parts: [{ text }] });
    return text;
  } catch (err) {
    throw err.name === 'AbortError' ? new Error('timeout della richiesta') : err;
  } finally {
    clearTimeout(timeoutId);
  }
}

function sendQuickPrompt(text) {
  document.getElementById('ai-input').value = text;
  sendAIMessage();
}

/* ---------- VOCE: TTS & STT ---------- */
let availableVoices = [];

function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  availableVoices = window.speechSynthesis.getVoices().filter(v => (v.lang || '').toLowerCase().startsWith('it'));
  const select = document.getElementById('voice-select');
  if (!select) return;
  select.innerHTML = '';
  const def = document.createElement('option');
  def.value = '';
  def.textContent = availableVoices.length ? 'Predefinita del dispositivo' : 'Nessuna voce italiana trovata';
  select.appendChild(def);
  availableVoices.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.voiceURI;
    opt.textContent = `${v.name} (${v.lang})`;
    select.appendChild(opt);
  });
  select.value = appState.selectedVoiceURI && availableVoices.some(v => v.voiceURI === appState.selectedVoiceURI)
    ? appState.selectedVoiceURI : '';
}

function initSpeechEngine() {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.onvoiceschanged = loadVoices;
  loadVoices(); // alcuni browser hanno già le voci pronte e non emettono l'evento
}

function changeVoice(uri) {
  appState.selectedVoiceURI = uri || null;
  saveState();
}

function speakText(text) {
  if (!appState.ttsEnabled || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const clean = String(text).replace(/\*\*|[_#`]/g, '').replace(/\n+/g, '. ');
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.lang = 'it-IT';
  const voice = availableVoices.find(v => v.voiceURI === appState.selectedVoiceURI);
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

function toggleTTS() {
  appState.ttsEnabled = !appState.ttsEnabled;
  saveState();
  if (!appState.ttsEnabled && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  document.getElementById('tts-toggle-btn').innerText = `TTS: ${appState.ttsEnabled ? 'ON' : 'OFF'}`;
}

let recognition = null;
function setMicActive(active) {
  const btn = document.getElementById('mic-btn');
  if (!btn) return;
  btn.classList.toggle('text-red-400', active);
  btn.classList.toggle('animate-pulse', active);
}

function toggleVoiceRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { alert('Riconoscimento vocale non supportato da questo browser.'); return; }
  if (recognition) { recognition.stop(); return; }

  recognition = new SR();
  recognition.lang = 'it-IT';
  recognition.interimResults = false;
  recognition.onstart = () => setMicActive(true);
  recognition.onresult = e => {
    document.getElementById('ai-input').value = e.results[0][0].transcript;
    sendAIMessage();
  };
  recognition.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      alert('Accesso al microfono negato: consentilo dalle impostazioni del browser.');
    }
  };
  recognition.onend = () => { recognition = null; setMicActive(false); };
  try { recognition.start(); } catch (e) { recognition = null; setMicActive(false); }
}

/* ---------- IMPOSTAZIONI ---------- */
function updateAIName(name) {
  appState.aiName = (name || '').trim() || 'Jarvis';
  saveState();
  applySettingsToUI();
}

function updateGeminiKey(key) { appState.geminiApiKey = key.trim(); saveState(); }

function updateGeminiModel(model) {
  appState.geminiModel = model.trim() || DEFAULT_GEMINI_MODEL;
  saveState();
  applySettingsToUI();
}

function updateWorkerURL(url) {
  const value = url.trim() || DEFAULT_WORKER_URL;
  try { new URL(value); } catch (e) {
    alert('URL del Worker non valido.');
    applySettingsToUI();
    return;
  }
  appState.workerUrl = value;
  saveState();
  applySettingsToUI();
}

function updateWorkerSecret(secret) { appState.workerSecret = secret.trim(); saveState(); }

/* ---------- TELEGRAM MORNING REPORT (tramite Worker) ---------- */
async function triggerMorningReport() {
  const btn = document.getElementById('morning-report-btn');
  const t = computeTotals();
  const txt = id => (document.getElementById(id) || {}).textContent || '—';
  const text = `Morning Report ${new Date().toLocaleDateString('it-IT')}\n` +
    `Patrimonio netto: ${formatEUR(t.net)} (liquidità ${formatEUR(t.liq)}, investito ${formatEUR(t.inv)})\n` +
    `FV ${txt('telemetry-pv')} kW • Batteria ${txt('telemetry-battery')}% • Carico ${txt('telemetry-load')} kW`;

  let endpoint;
  try {
    endpoint = new URL((appState.workerUrl || DEFAULT_WORKER_URL).trim());
    endpoint.searchParams.set('action', 'morning-report');
  } catch (e) { alert('URL del Worker non valido: controllalo nelle Impostazioni.'); return; }

  if (btn) btn.disabled = true;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (appState.workerSecret) headers['X-App-Secret'] = appState.workerSecret;
    const res = await fetch(endpoint.toString(), { method: 'POST', headers, body: JSON.stringify({ text }), signal: controller.signal });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.success) throw new Error((data && data.error) || `HTTP ${res.status}`);
    alert('Morning Report inviato su Telegram.');
  } catch (err) {
    alert(`Invio non riuscito: ${err.name === 'AbortError' ? 'timeout' : err.message}`);
  } finally {
    clearTimeout(timeoutId);
    if (btn) btn.disabled = false;
  }
}

/* ---------- BACKUP ---------- */
function exportBackupJSON() {
  // Le chiavi segrete non vengono esportate: il file si può condividere/archiviare senza rischi.
  const data = Object.assign({}, appState, { geminiApiKey: '', workerSecret: '' });
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Cognitive_Core_Backup_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importBackupJSON(e) {
  const input = e.target;
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const parsed = JSON.parse(ev.target.result);
      const valid = parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
        ['assets', 'fidelityCards', 'credentials'].some(k => Array.isArray(parsed[k]));
      if (!valid) throw new Error('il file non è un backup di Cognitive Core');
      if (!confirm('Importare il backup? I dati attuali verranno sostituiti.')) return;
      const imported = normalizeState(parsed);
      if (!imported.geminiApiKey) imported.geminiApiKey = appState.geminiApiKey;
      if (!imported.workerSecret) imported.workerSecret = appState.workerSecret;
      appState = imported;
      saveState();
      applySettingsToUI();
      renderAssets();
      renderFidelityCards();
      renderCredentials();
      loadVoices();
      alert('Backup importato correttamente.');
    } catch (err) {
      alert(`Import non riuscito: ${err.message}`);
    } finally {
      input.value = '';
    }
  };
  reader.onerror = () => { alert('Impossibile leggere il file.'); input.value = ''; };
  reader.readAsText(file);
}

/* ---------- DRAWER AI ---------- */
function setAIDrawer(open) {
  const drawer = document.getElementById('ai-drawer');
  drawer.classList.toggle('translate-x-full', !open);
  drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (open) {
    drawer.removeAttribute('inert');
    setTimeout(() => document.getElementById('ai-input').focus({ preventScroll: true }), 50);
  } else {
    drawer.setAttribute('inert', '');
  }
}

function toggleAIDrawer() {
  setAIDrawer(document.getElementById('ai-drawer').classList.contains('translate-x-full'));
}

/* ---------- PALETTE COMANDI (Ctrl/Cmd+K) ---------- */
const CMD_ITEMS = [
  { label: 'Vai a Ecosistema & Micro-Grid', run: () => switchTab('ecosystem') },
  { label: 'Vai a Finanza & Asset Dashboard', run: () => switchTab('finance') },
  { label: 'Vai a Vault & Fidelity Wallet', run: () => switchTab('vault') },
  { label: 'Vai a TrenoLive Tracker', run: () => switchTab('trains') },
  { label: 'Vai a Impostazioni', run: () => switchTab('settings') },
  { label: 'Apri assistente AI', run: () => setAIDrawer(true) },
  { label: 'Aggiungi asset', run: () => { switchTab('finance'); addNewAssetPrompt(); } },
  { label: 'Nuova carta fedeltà', run: () => { switchTab('vault'); addNewCardPrompt(); } },
  { label: 'Nuova credenziale', run: () => { switchTab('vault'); addNewCredentialPrompt(); } },
  { label: 'Esporta backup JSON', run: exportBackupJSON }
];

function matchingCmds() {
  const q = stripAccents((document.getElementById('cmd-input') || {}).value || '');
  return CMD_ITEMS.filter(c => stripAccents(c.label).includes(q));
}

function filterCmdResults() {
  const box = document.getElementById('cmd-results');
  if (!box) return;
  box.innerHTML = '';
  const list = matchingCmds();
  if (list.length === 0) { box.appendChild(el('div', 'p-2 text-slate-500', 'Nessun comando trovato')); return; }
  list.forEach(c => {
    const row = el('div', 'p-2 hover:bg-slate-800 rounded cursor-pointer', c.label);
    row.addEventListener('click', () => { closeCmdPalette(); c.run(); });
    box.appendChild(row);
  });
}

function runFirstCmdResult() {
  const first = matchingCmds()[0];
  if (!first) return;
  closeCmdPalette();
  first.run();
}

function openCmdPalette() {
  const input = document.getElementById('cmd-input');
  input.value = '';
  filterCmdResults();
  document.getElementById('cmd-palette').classList.remove('hidden');
  input.focus();
}

function closeCmdPalette() { document.getElementById('cmd-palette').classList.add('hidden'); }

function handleGlobalKeys(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    const open = !document.getElementById('cmd-palette').classList.contains('hidden');
    if (open) closeCmdPalette(); else openCmdPalette();
  } else if (e.key === 'Escape') {
    closeCmdPalette();
    closeBarcodeModal();
    setAIDrawer(false);
  }
}
