// Cognitive Ecosystem v5.4 (fixed) - Cloudflare Worker
const TZ = "Europe/Rome";
const cors = (env) => ({ "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" });
const J = (o, env, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors(env), "Content-Type": "application/json", "Cache-Control": "no-store" } });
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------- Tempo (Europe/Rome) ----------
function romeParts(d = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
}
const dayKey = (d = new Date()) => { const p = romeParts(d); return `${p.year}-${p.month}-${p.day}`; };
const romeHour = () => { const p = romeParts(); return +p.hour + +p.minute / 60; };
const romeTime = () => new Date().toLocaleTimeString("it-IT", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
function dayBounds() {
  const g = new Date(dayKey() + "T00:00:00Z"), p = romeParts(g);
  const off = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - g.getTime();
  const start = new Date(g.getTime() - off);
  return [start.toISOString(), new Date(start.getTime() + 864e5).toISOString()];
}

// ---------- Dati giornalieri / log ----------
async function dayData(env, k) {
  if (!env.MORNING_KV) return { bio: null, logs: [], hobby: [] };
  const [bio, logs, hobby] = await Promise.all(["bio", "logs", "hobby"].map((x) => env.MORNING_KV.get(`${x}:${k}`, "json")));
  return { bio, logs: logs || [], hobby: hobby || [] };
}
async function saveBio(env, s, h, st) {
  const readiness = Math.max(0, Math.min(100, s * 8 + h * 8 + (6 - st) * 4));
  const bio = { sleep: s, hrv: h, stress: st, readiness, updatedAt: new Date().toISOString() };
  if (env.MORNING_KV) await env.MORNING_KV.put(`bio:${dayKey()}`, JSON.stringify(bio), { expirationTtl: 90 * 864e3 });
  return bio;
}
// Avviso proattivo (una volta al giorno): batteria satura in fascia di picco -> carica la BYD
async function bydAlert(env) {
  const h = romeHour();
  if (!env.TELEGRAM_CHAT_ID || !env.MORNING_KV || h < 11.5 || h > 15.5) return;
  const key = `byd:${dayKey()}`;
  if (await env.MORNING_KV.get(key)) return;
  const s = await getSolar(env);
  if (!s.isLive || s.batterySoc == null || s.batterySoc < 95 || (s.pvPowerkW ?? 0) < 1) return;
  await env.MORNING_KV.put(key, "1", { expirationTtl: 86400 });
  await sendText(env, env.TELEGRAM_CHAT_ID, `🚗 Batteria 10 kWh al ${s.batterySoc}% con FV a ${s.pvPowerkW} kW: è il momento di caricare la BYD Dolphin.`);
}
async function addEntry(env, type, value) {
  const kind = type === "water" ? "logs" : "hobby";
  if (!env.MORNING_KV) return { total: value, msg: "⚠️ KV non configurato: dato non salvato." };
  const key = `${kind}:${dayKey()}`;
  const list = (await env.MORNING_KV.get(key, "json")) || [];
  list.push(type === "water" ? { type, amount: value, time: romeTime() } : { duration: value, time: romeTime() });
  await env.MORNING_KV.put(key, JSON.stringify(list), { expirationTtl: 90 * 864e3 });
  const total = list.reduce((a, c) => a + (c.amount || c.duration || 0), 0);
  return { total, msg: type === "water" ? `💧 +${value} ml. Totale oggi: ${total} ml.` : `🎨 +${value} min di focus artistico. Totale oggi: ${total} min.` };
}
// Parser unico (voce, testo libero, /log, /art, PWA)
function parseCommand(text) {
  const t = text.toLowerCase(); let m;
  if (/\b(acqua|bevut[oa]|idratazione)\b|\b\d+\s*(ml|cl)\b|litro/.test(t)) {
    let ml = null;
    if ((m = t.match(/(\d+(?:[.,]\d+)?)\s*(ml|millilitri|cl|l|litri?)\b/))) {
      const v = parseFloat(m[1].replace(",", ".")), u = m[2];
      ml = u === "ml" || u.startsWith("milli") ? v : u[0] === "c" ? v * 10 : v * 1000;
    } else if (/mezzo litro/.test(t)) ml = 500;
    else if (/\bun litro\b/.test(t)) ml = 1000;
    else if ((m = t.match(/\b(\d{2,4})\b/))) ml = +m[1];
    if (ml) return { type: "water", value: Math.round(ml) };
  }
  if (/disegn|hobby|pittur|asaro|warhammer|modell|dipint/.test(t)) {
    let min = 45;
    if ((m = t.match(/(\d+(?:[.,]\d+)?)\s*(ore|ora|h)\b/))) min = Math.round(parseFloat(m[1].replace(",", ".")) * 60);
    else if ((m = t.match(/(\d+)/))) min = +m[1];
    return { type: "hobby", value: min };
  }
  return null;
}
async function runCommand(env, text) {
  const c = parseCommand(text);
  if (!c) return { ok: false, msg: `🤖 Non ho capito: "${text}". Prova "Ho bevuto 500 ml" o "Ho disegnato 45 minuti".` };
  const r = await addEntry(env, c.type, c.value);
  return { ok: true, msg: r.msg, total: r.total };
}

// ---------- Fotovoltaico ----------
const pick = (o, ...k) => { for (const x of k) if (o[x] != null && o[x] !== "" && !isNaN(o[x])) return +o[x]; return null; };
const kw = (w) => (w == null ? null : Math.round(w / 10) / 100);
// Convenzione: rete + = prelievo, batteria + = carica
function normalizeSolar(raw, source) {
  const pv = pick(raw, "pv_power", "pac", "solarPower", "pvPowerW"), batt = pick(raw, "battery_power", "p_battery", "batteryPowerW");
  const grid = pick(raw, "grid_power", "p_grid", "gridPowerW"), soc = pick(raw, "soc", "battery_soc", "batteryLevel");
  let load = pick(raw, "load_power", "p_load", "loadPowerW");
  if (load == null && pv != null && grid != null && batt != null) load = Math.max(0, pv + grid - batt);
  return { isLive: true, source, timestamp: new Date().toISOString(), pvPowerkW: kw(pv), batteryPowerkW: kw(batt), batterySoc: soc == null ? null : Math.min(100, Math.max(0, Math.round(soc))), gridPowerkW: kw(grid), loadPowerkW: kw(load) };
}
async function getSolar(env) {
  if (env.SUNPOWER_URL) { // gateway raggiungibile via tunnel HTTPS
    try {
      const c = new AbortController(), t = setTimeout(() => c.abort(), 3000);
      const h = { Accept: "application/json" }; if (env.SUNPOWER_AUTH) h.Authorization = env.SUNPOWER_AUTH;
      const r = await fetch(env.SUNPOWER_URL, { headers: h, signal: c.signal }); clearTimeout(t);
      if (r.ok) return normalizeSolar(await r.json(), "Gateway SunPower (tunnel)");
    } catch (e) { console.warn("Gateway non raggiungibile:", e.message); }
  }
  if (env.MORNING_KV) { // snapshot spinto da un bridge locale
    const s = await env.MORNING_KV.get("solar:last", "json");
    if (s && Date.now() - s.ts < 6 * 60e3) return { ...normalizeSolar(s.raw, "Bridge locale"), timestamp: new Date(s.ts).toISOString() };
  }
  return { isLive: false, source: "Nessun dato dall'impianto", timestamp: new Date().toISOString(), pvPowerkW: null, batteryPowerkW: null, batterySoc: null, gridPowerkW: null, loadPowerkW: null };
}

// ---------- Meteo / Calendario ----------
async function getWeather(env) {
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${env.LAT || 41.9028}&longitude=${env.LON || 12.4964}&current=temperature_2m,precipitation,wind_speed_10m,uv_index`, { cf: { cacheTtl: 900, cacheEverything: true } });
    if (r.ok) return (await r.json()).current;
  } catch (e) { console.warn(e.message); }
  return null;
}
async function getCalendar(env) {
  const empty = { count: 0, items: [] };
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_REFRESH_TOKEN) return empty;
  try {
    const tr = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: env.GOOGLE_REFRESH_TOKEN, grant_type: "refresh_token" }) });
    const tok = (await tr.json()).access_token; if (!tok) return empty;
    const [a, b] = dayBounds();
    const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${a}&timeMax=${b}&singleEvents=true&orderBy=startTime`, { headers: { Authorization: `Bearer ${tok}` } });
    const items = (await r.json()).items || [];
    return { count: items.length, items: items.map((e) => ({ summary: e.summary, start: e.start.dateTime ? new Date(e.start.dateTime).toLocaleTimeString("it-IT", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }) : "Tutto il giorno" })) };
  } catch (e) { return empty; }
}

// ---------- Report ----------
function buildReport(bio, weather, calendar, logs, hobby, solar) {
  const readiness = bio ? bio.readiness : null, hour = romeHour(), ev = calendar.count || 0;
  const rain = weather ? weather.precipitation ?? 0 : null, temp = weather ? weather.temperature_2m : null;
  const f = (v, u) => (v == null ? "--" : `${v} ${u}`);
  let pvAdvice, batteryStatus;
  if (!solar.isLive) {
    pvAdvice = "☀️ SunPower: dati reali non disponibili (configura tunnel o bridge, vedi README).";
    batteryStatus = "🔋 Batteria 10 kWh: stato sconosciuto.";
  } else {
    const peak = hour >= 11.5 && hour <= 15.5, soc = solar.batterySoc;
    const byd = !peak ? "Fuori fascia di picco (11:30-15:30): niente ricarica BYD da FV." : soc != null && soc >= 95 ? "Batteria satura: ricarica ora la BYD Dolphin." : `Attendi la saturazione della batteria (${f(soc, "%")}) prima di caricare la BYD.`;
    pvAdvice = `☀️ FV ${f(solar.pvPowerkW, "kW")} | Casa ${f(solar.loadPowerkW, "kW")} | Rete ${f(solar.gridPowerkW, "kW")}. ${byd}`;
    batteryStatus = `🔋 Batteria 10 kWh: ${f(solar.batterySoc, "%")} (flusso ${f(solar.batteryPowerkW, "kW")}).`;
  }
  const gardenBlocked = rain != null && rain > 0;
  const gardenAdvice = rain == null ? "🌿 Meteo non disponibile." : gardenBlocked ? "🌧️ Giardino: pioggia rilevata, irrigazione sospesa." : temp > 14 ? "🌿 Giardino (1000 mq, 20 alberi): niente pioggia, ok irrigazione mirata e siepi." : "🌿 Giardino: asciutto ma fresco, irrigazione non urgente.";
  const art = hobby.reduce((a, h) => a + (h.duration || 0), 0), studyBlocked = readiness != null && readiness < 40;
  const creativeAdvice = readiness == null || readiness > 60 ? `🎨 Creative Flow (45-60 min): sessione su anatomia (testa di Asaro) o pittura WH40K. Oggi: ${art} min.` : `🛋️ Creative Rest: readiness ${readiness}%. Niente studio anatomico complesso, solo attività a basso impatto visivo. Oggi: ${art} min.`;
  let brutalDirective;
  if (readiness == null) brutalDirective = "⚠️ Check-in mattutino non registrato: invia /report su Telegram.";
  else if (studyBlocked) brutalDirective = `🔴 DIAGNOSI SPIETATA: ${ev} impegni e readiness ${readiness}%. Studio complesso BLOCCATO, riposo visivo, taglia il superfluo.`;
  else if (readiness < 75) brutalDirective = `🟡 DIAGNOSI STRATEGICA: readiness ${readiness}%. Lavora a blocchi Pomodoro, senza distrazioni.`;
  else brutalDirective = `🔥 PEAK PERFORMANCE: readiness ${readiness}%. Problemi difficili nella prima metà della giornata.`;
  return { readiness, bio, weather, calendar, solar, pvAdvice, batteryStatus, gardenAdvice, gardenBlocked, creativeAdvice, studyBlocked, brutalDirective, hydraTarget: temp > 22 ? 3000 : 2500, logs, hobbyLogs: hobby };
}
async function fullReport(env, bioOverride) {
  const [d, weather, calendar, solar] = await Promise.all([dayData(env, dayKey()), getWeather(env), getCalendar(env), getSolar(env)]);
  return buildReport(bioOverride || d.bio, weather, calendar, d.logs, d.hobby, solar);
}
const reportHtml = (r) => `<b>⚡ Readiness: ${r.readiness ?? "--"}%</b>\n${esc(r.brutalDirective)}\n\n${esc(r.pvAdvice)}\n${esc(r.batteryStatus)}\n${esc(r.gardenAdvice)}\n${esc(r.creativeAdvice)}`;

// ---------- Telegram ----------
const tg = (env, method, body) => fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch((e) => console.error(method, e.message));
const sendText = (env, chat_id, text, extra = {}) => tg(env, "sendMessage", { chat_id, text, parse_mode: "HTML", ...extra });
const kb = (prefix) => ({ inline_keyboard: [[1, 2, 3, 4, 5].map((i) => ({ text: String(i), callback_data: prefix + i }))] });
const edit = (env, chat_id, message_id, text, reply_markup) => tg(env, "editMessageText", { chat_id, message_id, text, parse_mode: "HTML", reply_markup });
const sendMorningPrompt = (env, chatId = env.TELEGRAM_CHAT_ID) => chatId && sendText(env, chatId, "☀️ <b>Check-in mattutino</b>\nQualità del sonno (1-5)?", { reply_markup: kb("sleep_") });
const askHRVPrompt = (env, c, m, s) => edit(env, c, m, `Sonno: ${s}/5\n<b>HRV (1-5)?</b>`, kb(`hrv_${s}_`));
const askStressPrompt = (env, c, m, s, h) => edit(env, c, m, `Sonno: ${s}/5 | HRV: ${h}/5\n<b>Stress percepito (1-5)?</b>`, kb(`stress_${s}_${h}_`));
const updateTelegramWithCognitiveReport = (env, c, m, r) => edit(env, c, m, reportHtml(r));
async function triggerMiddayCheck(env, chatId = env.TELEGRAM_CHAT_ID) {
  if (!chatId) return;
  const r = await fullReport(env), ml = r.logs.reduce((a, c) => a + (c.amount || 0), 0);
  await sendText(env, chatId, `🕛 <b>Check di metà giornata</b>\n💧 Acqua: ${ml}/${r.hydraTarget} ml\n${esc(r.pvAdvice)}\n${esc(r.batteryStatus)}\n${esc(r.gardenAdvice)}`);
}
async function transcribeVoice(env, fileId) {
  if (!env.OPENAI_API_KEY) return null;
  try {
    const f = await (await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`)).json();
    const blob = await (await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${f.result.file_path}`)).blob();
    const fd = new FormData(); fd.append("file", blob, "audio.oga"); fd.append("model", "whisper-1"); fd.append("language", "it");
    const w = await (await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: fd })).json();
    return w.text || null;
  } catch (e) { console.error("Whisper:", e.message); return null; }
}
async function handleTelegram(env, req) {
  if (env.TELEGRAM_WEBHOOK_SECRET && req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_WEBHOOK_SECRET) return new Response("Forbidden", { status: 403 });
  const u = await req.json();
  const chatId = (u.message || u.callback_query?.message)?.chat.id;
  if (!chatId || (env.TELEGRAM_CHAT_ID && String(chatId) !== String(env.TELEGRAM_CHAT_ID))) return new Response("OK");
  if (u.message) {
    const m = u.message;
    if (m.voice || m.audio) {
      const text = await transcribeVoice(env, (m.voice || m.audio).file_id);
      if (!text) await sendText(env, chatId, "⚠️ Trascrizione non riuscita (controlla OPENAI_API_KEY).");
      else await sendText(env, chatId, `🎙️ "${esc(text)}"\n${esc((await runCommand(env, text)).msg)}`);
    } else if (m.text) {
      const t = m.text.trim(), n = parseInt(t.split(/\s+/)[1], 10);
      if (t === "/start" || t === "/report") await sendMorningPrompt(env, chatId);
      else if (t === "/midday") await triggerMiddayCheck(env, chatId);
      else if (t.startsWith("/log")) await sendText(env, chatId, isNaN(n) ? "Usa: /log 500" : esc((await addEntry(env, "water", n)).msg));
      else if (t.startsWith("/art") || t.startsWith("/hobby")) await sendText(env, chatId, isNaN(n) ? "Usa: /art 45" : esc((await addEntry(env, "hobby", n)).msg));
      else await sendText(env, chatId, esc((await runCommand(env, t)).msg));
    }
  } else if (u.callback_query) {
    const q = u.callback_query, mid = q.message.message_id, d = q.data.split("_");
    await tg(env, "answerCallbackQuery", { callback_query_id: q.id });
    const nums = d.slice(1).map(Number);
    if (nums.some((x) => !(x >= 1 && x <= 5))) return new Response("OK");
    if (d[0] === "sleep" && nums.length === 1) await askHRVPrompt(env, chatId, mid, nums[0]);
    else if (d[0] === "hrv" && nums.length === 2) await askStressPrompt(env, chatId, mid, ...nums);
    else if (d[0] === "stress" && nums.length === 3) {
      const bio = await saveBio(env, ...nums);
      await updateTelegramWithCognitiveReport(env, chatId, mid, await fullReport(env, bio));
    }
  }
  return new Response("OK");
}

// ---------- Router ----------
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(event.cron === "0 11 * * *" ? triggerMiddayCheck(env) : event.cron === "0 6 * * *" ? sendMorningPrompt(env) : bydAlert(env));
  },
  async fetch(req, env, ctx) {
    const p = new URL(req.url).pathname;
    if (req.method === "OPTIONS") return new Response(null, { headers: cors(env) });
    if (p.startsWith("/api/")) {
      if (env.API_TOKEN && req.headers.get("Authorization") !== `Bearer ${env.API_TOKEN}`) return J({ error: "unauthorized" }, env, 401);
      try {
        if (p === "/api/solar/live") return J(await getSolar(env), env);
        if (p === "/api/solar/push" && req.method === "POST") {
          if (!env.API_TOKEN || !env.MORNING_KV) return J({ error: "serve API_TOKEN e MORNING_KV" }, env, 400);
          await env.MORNING_KV.put("solar:last", JSON.stringify({ ts: Date.now(), raw: await req.json() }), { expirationTtl: 900 });
          return J({ ok: true }, env);
        }
        if (p === "/api/today") return J(await fullReport(env), env);
        if (p === "/api/history") {
          const days = Math.min(30, Math.max(1, parseInt(new URL(req.url).searchParams.get("days") || "7", 10) || 7));
          const keys = Array.from({ length: days }, (_, i) => dayKey(new Date(Date.now() - (days - 1 - i) * 864e5)));
          const rows = await Promise.all(keys.map((k) => dayData(env, k)));
          return J(keys.map((date, i) => ({ date, data: rows[i].bio, logs: rows[i].logs, hobby: rows[i].hobby })), env);
        }
        if (p === "/api/checkin" && req.method === "POST") {
          const b = await req.json(), v = [b.sleep, b.hrv, b.stress].map((x) => Math.round(+x));
          if (v.some((x) => !(x >= 1 && x <= 5))) return J({ error: "valori da 1 a 5" }, env, 400);
          return J(await fullReport(env, await saveBio(env, ...v)), env);
        }
        if (p === "/api/log" && req.method === "POST") {
          const b = await req.json();
          if (b.text) return J(await runCommand(env, String(b.text)), env);
          const v = Math.round(+b.value);
          if (!["water", "hobby"].includes(b.type) || !(v > 0 && v < 10000)) return J({ ok: false, msg: "Dati non validi" }, env, 400);
          const r = await addEntry(env, b.type, v);
          return J({ ok: true, msg: r.msg, total: r.total }, env);
        }
      } catch (e) { console.error(e); return J({ error: "errore interno" }, env, 500); }
      return J({ error: "not found" }, env, 404);
    }
    if (req.method === "POST" && (p === "/" || p === "/webhook")) {
      try { return await handleTelegram(env, req); } catch (e) { console.error("Webhook:", e); return new Response("OK"); }
    }
    return new Response("Cognitive Ecosystem v5.4 attivo");
  },
};
