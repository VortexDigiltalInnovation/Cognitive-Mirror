# Cognitive Ecosystem v5.4 (fixed)

## Deploy worker
1. `wrangler kv namespace create MORNING_KV` → incolla l'id in `wrangler.toml`
2. Secret (`wrangler secret put NOME`):
   - `API_TOKEN` (consigliato: protegge /api/*; stesso valore nel campo token della PWA)
   - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`
   - `OPENAI_API_KEY` (vocali Whisper), `GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN` (calendario)
3. `wrangler deploy`, poi registra il webhook:
   `https://api.telegram.org/bot<TOKEN>/setWebhook?url=<WORKER_URL>/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>`
4. Pubblica la PWA (index.html, sw.js, manifest, icone) su HTTPS e inserisci URL worker + token.

## Dati reali SunPower (il worker NON vede la tua LAN)
- **A) Bridge locale (più semplice):** un Raspberry/Home Assistant/PC in casa legge il gateway e ogni 2-3 minuti fa
  `POST <WORKER>/api/solar/push` con `Authorization: Bearer <API_TOKEN>` e JSON, es.
  `{"pv_power":4200,"battery_power":900,"soc":96,"grid_power":-1800,"load_power":1500}` (Watt).
  Convenzione: rete + = prelievo, batteria + = carica. Dati validi 6 minuti.
  (Limite free KV: 1000 scritture/giorno, quindi non spingere più spesso di ogni 2 min.)
- **B) Tunnel:** esponi il gateway con Cloudflare Tunnel/Tailscale Funnel e imposta `SUNPOWER_URL` (e `SUNPOWER_AUTH`).
- Nomi campi accettati: pv_power/pac/solarPower, battery_power/p_battery, soc/battery_soc, grid_power/p_grid, load_power/p_load.
  Se il tuo gateway usa altri nomi, mandami un esempio di JSON.
- Senza dati la PWA mostra "NON DISPONIBILE" (niente più simulazioni).

## Bridge e funzioni extra
- `bridge/sunpower_bridge.py` (Python 3, nessuna dipendenza):
  `GATEWAY_URL=http://192.168.1.100/api/v1/status WORKER_URL=https://... API_TOKEN=... python3 sunpower_bridge.py`
  Se il JSON del gateway è annidato usa `FIELD_MAP="pv_power=data.pac,soc=data.battery.soc"`.
- Avviso Telegram automatico (1 volta/giorno) quando la batteria è ≥95% in fascia 11:30-15:30: carica la BYD.
- La PWA ha check-in mattutino e idratazione con barra di avanzamento (non serve più Telegram).
