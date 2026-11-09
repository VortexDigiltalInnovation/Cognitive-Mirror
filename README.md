# Cognitive Core OS v17.1 Ultra Enterprise

PWA local-first: micro-grid (telemetria dimostrativa), finanza, carte fedeltà con barcode, vault credenziali, TrenoLive e assistente AI.

## Cosa fa l'assistente
- **Senza API Key** (o offline): comandi locali — diagnosi, patrimonio/liquidità/investito, modalità inverter Auto.
- **Con Gemini API Key** (Impostazioni): risposte libere con contesto della conversazione. Il modello è configurabile (default `gemini-flash-latest`); se la chiamata fallisce, l'errore è mostrato e si usa la risposta locale.
- TTS in italiano con scelta della voce (salvata); dettatura vocale con il pulsante microfono. La wake word continua non è implementata.

## Struttura
- `index.html`, `app.js`: interfaccia e logica.
- `sw.js`: service worker (cache dell'app e delle librerie CDN dopo il primo avvio online).
- `manifest.json`, `icon*.png`, `icon.svg`, `apple-touch-icon.png`: risorse PWA.
- `workers/trenolive_proxy.js`: Worker Cloudflare per treni (`?treno=NUMERO`) e Morning Report Telegram (`?action=morning-report`, POST).

## Configurazione del Worker
Pubblica `workers/trenolive_proxy.js` e inserisci l'URL nelle Impostazioni. Per il Morning Report definisci nel Worker le variabili
`TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID`; opzionale `APP_SECRET` (stesso valore nel campo "Segreto Worker").

## Note
- Il backup JSON non include API Key e segreto del Worker.
- I dati restano nel `localStorage` del browser, non cifrati: non salvare password nel Vault.
