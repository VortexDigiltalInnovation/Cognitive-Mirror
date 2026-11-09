// Cloudflare Worker - TrenoLive proxy + Telegram Morning Report
// Variabili opzionali (Settings > Variables): APP_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-App-Secret',
  'Access-Control-Max-Age': '86400'
};

const VT_BASE = 'https://www.viaggiatreno.it/infomobilitamobile/resteasy/viaggiatreno';
const UPSTREAM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer': 'https://www.viaggiatreno.it/',
  'Cache-Control': 'no-cache'
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS }
  });
}

async function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function trainStatus(url) {
  const num = (url.searchParams.get('treno') || '').trim();
  if (!/^\d{1,5}$/.test(num)) return json({ success: false, error: 'Numero treno non valido (1-5 cifre)' }, 400);

  try {
    // 1) Risolve il codice stazione d'origine e la data di partenza
    const r1 = await fetchWithTimeout(`${VT_BASE}/cercaNumeroTrenoTrenoAutocomplete/${num}`, { headers: UPSTREAM_HEADERS });
    if (!r1.ok) return json({ success: false, train: num, error: `ViaggiaTreno ha risposto ${r1.status}` }, 502);
    const line = (await r1.text()).trim().split('\n')[0] || '';
    if (!line) return json({ success: false, train: num, error: 'Treno non trovato' }, 404);

    // Formato riga: "9524 - STAZIONE|9524-S08409-1762470000000"
    const [, origin, epoch] = (line.split('|')[1] || '').trim().split('-');
    if (!origin) return json({ success: false, train: num, error: 'Risposta ViaggiaTreno non riconosciuta' }, 502);

    // 2) Andamento del treno
    const r2 = await fetchWithTimeout(`${VT_BASE}/andamentoTreno/${origin}/${num}/${epoch || Date.now()}`, { headers: UPSTREAM_HEADERS });
    if (!r2.ok) return json({ success: false, train: num, error: `ViaggiaTreno ha risposto ${r2.status}` }, 502);
    let j;
    try { j = JSON.parse(await r2.text()); } catch (e) {
      return json({ success: false, train: num, error: 'Risposta ViaggiaTreno non in formato JSON' }, 502);
    }

    return json({
      success: true,
      train: num,
      categoria: j.categoria,
      origine: j.origine,
      destinazione: j.destinazione,
      ritardo: j.ritardo,
      stazioneUltimoRilevamento: j.stazioneUltimoRilevamento,
      oraUltimoRilevamento: j.oraUltimoRilevamento,
      fermate: (j.fermate || []).map(f => ({
        stazione: f.stazione, programmata: f.programmata, effettiva: f.effettiva, ritardo: f.ritardo
      }))
    });
  } catch (err) {
    const msg = err.name === 'AbortError' ? 'Timeout interrogando ViaggiaTreno' : err.message;
    return json({ success: false, train: num, error: msg }, 504);
  }
}

async function morningReport(request, env) {
  if (request.method !== 'POST') return json({ success: false, error: 'Usa il metodo POST' }, 405);
  if (env.APP_SECRET && request.headers.get('X-App-Secret') !== env.APP_SECRET) {
    return json({ success: false, error: 'Non autorizzato' }, 401);
  }
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return json({ success: false, error: 'Telegram non configurato nel Worker (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)' }, 501);
  }
  let body;
  try { body = await request.json(); } catch (e) { return json({ success: false, error: 'Corpo della richiesta non valido' }, 400); }
  const text = String((body && body.text) || '').slice(0, 3500);
  if (!text) return json({ success: false, error: 'Testo mancante' }, 400);

  try {
    const r = await fetchWithTimeout(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) return json({ success: false, error: data.description || `Telegram ${r.status}` }, 502);
    return json({ success: true });
  } catch (err) {
    return json({ success: false, error: err.name === 'AbortError' ? 'Timeout Telegram' : err.message }, 504);
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    if (url.searchParams.get('action') === 'morning-report') return morningReport(request, env);
    if (request.method !== 'GET') return json({ success: false, error: 'Metodo non consentito' }, 405);
    return trainStatus(url);
  }
};
