import requests, json, csv, sys
from concurrent.futures import ThreadPoolExecutor
S = requests.Session(); S.headers["user-agent"] = "Mozilla/5.0"
B = "https://site.api.espn.com/apis/site/v2/sports/football/nfl"
def get(u, **p):
    for _ in range(3):
        try:
            r = S.get(u, params=p, timeout=20)
            if r.ok: return r.json()
        except Exception: pass
    return None
ids = []
for season in (2022, 2023, 2024, 2025):
    for wk in range(1, 19):
        j = get(B + "/scoreboard", seasontype=2, week=wk, dates=season)
        for e in (j or {}).get("events", []):
            if e["status"]["type"].get("completed"): ids.append(e["id"])
print("juegos", len(ids), file=sys.stderr)
def uno(i):
    j = get(B + "/summary", event=i)
    if not j: return None
    comp = j["header"]["competitions"][0]
    eq = {c["homeAway"]: c["team"]["id"] for c in comp["competitors"]}
    pc = (j.get("pickcenter") or [{}])[0]
    spread, total = pc.get("spread"), pc.get("overUnder")
    det = pc.get("details") or ""
    td = None
    for sp in j.get("scoringPlays", []):
        if (sp.get("scoringType") or {}).get("abbreviation") == "TD":
            td = ("L" if sp["team"]["id"] == eq["home"] else "V", sp["period"]["number"]); break
    return [i, det, spread, total, td[0] if td else "", td[1] if td else 0]
with ThreadPoolExecutor(16) as ex:
    filas = [f for f in ex.map(uno, ids) if f]
w = csv.writer(sys.stdout); w.writerow(["id", "details", "spread", "total", "equipo", "cuarto"]); w.writerows(filas)
