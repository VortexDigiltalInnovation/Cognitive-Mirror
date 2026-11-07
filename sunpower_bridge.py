#!/usr/bin/env python3
"""Legge il gateway SunPower in LAN e spinge i dati al worker. Solo libreria standard.
Variabili: GATEWAY_URL, WORKER_URL, API_TOKEN, INTERVAL (s, default 120),
FIELD_MAP opzionale per JSON annidati, es. "pv_power=data.pac,soc=data.battery.soc"."""
import json, os, time, urllib.request

GW, WK, TOK = os.environ["GATEWAY_URL"], os.environ["WORKER_URL"].rstrip("/"), os.environ["API_TOKEN"]
EVERY = max(120, int(os.environ.get("INTERVAL", "120")))  # >=120s: limite scritture KV free
MAP = dict(p.split("=", 1) for p in os.environ.get("FIELD_MAP", "").split(",") if "=" in p)

def dig(d, path):
    for k in path.split("."):
        d = d[int(k)] if isinstance(d, list) else d[k]
    return d

def req(url, data=None, headers=None):
    r = urllib.request.Request(url, data=data, headers=headers or {}, method="POST" if data else "GET")
    with urllib.request.urlopen(r, timeout=10) as f:
        return json.load(f)

while True:
    try:
        raw = req(GW, headers={"Accept": "application/json"})
        for out, path in MAP.items():
            raw[out] = dig(raw, path)
        req(WK + "/api/solar/push", json.dumps(raw).encode(), {"Content-Type": "application/json", "Authorization": "Bearer " + TOK})
        print(time.strftime("%H:%M:%S"), "ok")
    except Exception as e:
        print(time.strftime("%H:%M:%S"), "errore:", e)
    time.sleep(EVERY)
