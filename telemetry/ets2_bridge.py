"""PTGamingSK Transport – ETS2 telemetry bridge (Python 3, stdlib).
Reads ONLY localhost telemetry and sends the current game sample to the driver's own Firestore document.
No credentials saved. Ctrl+C stops. Not an anti-cheat or payout verifier.
"""
import json
import math
import sys
import time
import getpass
import urllib.request
import urllib.parse
import urllib.error

PROJECT = "ptgamingsk-transport"
API_KEY = "AIzaSyCTyfLQgg3XCwdr8N_hUeLKrsWsnTmLwXM"
LOCAL_URL = "http://127.0.0.1:25555/api/ets2/telemetry"
BASE = "https://firestore.googleapis.com/v1/projects/" + PROJECT + "/databases/(default)/documents"
INTERVAL = 60

def request(url, data=None, token=None, form=False, local=False):
    headers = {"Accept": "application/json"}
    body = None
    if data is not None:
        body = (urllib.parse.urlencode(data) if form else json.dumps(data, allow_nan=False)).encode("utf-8")
        headers["Content-Type"] = "application/x-www-form-urlencoded" if form else "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, data=body, headers=headers)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({})) if local else urllib.request.build_opener()
    with opener.open(req, timeout=10) as r:
        return json.load(r)

def number(value, low, high):
    try:
        n = float(value)
        return round(min(high, max(low, n)), 2) if math.isfinite(n) else 0.0
    except (TypeError, ValueError):
        return 0.0

def label(value, length=100):
    return str(value or "")[:length]

def sample(raw):
    # SCS SDK structured JSON (sdkActive / truckValues / jobValues).
    if "sdkActive" in raw:
        if raw.get("sdkActive") is not True or str(raw.get("game", "")).upper() != "ETS2":
            return offline()
        truck = raw.get("truckValues") or {}
        constants = truck.get("constantsValues") or {}
        current = truck.get("currentValues") or {}
        dashboard = current.get("dashboardValues") or {}
        pos = (current.get("positionValue") or {}).get("position") or {}
        if not all(isinstance(pos.get(k), (int, float)) and math.isfinite(pos[k]) for k in ("x", "z")):
            return offline()
        job = raw.get("jobValues") or {}
        if not (raw.get("specialEventsValues") or {}).get("onJob"):
            job = {}
        return dict(game="ETS2", connected=True,
            x=number(pos["x"], -1e7, 1e7), z=number(pos["z"], -1e7, 1e7),
            speed=number(abs(number((dashboard.get("speed") or {}).get("kph"), -500, 500)), 0, 500),
            fuel=number((dashboard.get("fuelValue") or {}).get("amount"), 0, 20000),
            damage=number(number((current.get("damageValues") or {}).get("engine"), 0, 1) * 100, 0, 100),
            truck=label((" ".join([str(constants.get("brand") or ""), str(constants.get("name") or "")])).strip()),
            source=label(job.get("citySource")), destination=label(job.get("cityDestination")),
            cargo=label((job.get("cargoValues") or {}).get("name"), 150))
    # Legacy Funbit JSON.
    game = raw.get("game") or {}
    if not isinstance(game, dict):
        return offline()
    truck = raw.get("truck") or {}
    job = raw.get("job") or {}
    trailer = raw.get("trailer") or {}
    placement = truck.get("placement") or {}
    if not game.get("connected") or str(game.get("gameName", "")).upper() != "ETS2":
        return offline()
    if not all(isinstance(placement.get(k), (int, float)) and math.isfinite(placement[k]) for k in ("x", "z")):
        return offline()
    return dict(game="ETS2", connected=True,
        x=number(placement["x"], -1e7, 1e7), z=number(placement["z"], -1e7, 1e7),
        speed=number(abs(number(truck.get("speed"), -500, 500)), 0, 500),
        fuel=number(truck.get("fuel"), 0, 20000),
        damage=number(number(truck.get("wearEngine"), 0, 1) * 100, 0, 100),
        truck=label(str(truck.get("make") or "")+" "+str(truck.get("model") or "")),
        source=label(job.get("sourceCity")), destination=label(job.get("destinationCity")),
        cargo=label(trailer.get("name"), 150))

def offline():
    return dict(game="ETS2", connected=False, x=0.0, z=0.0, speed=0.0, fuel=0.0,
        damage=0.0, truck="", source="", destination="", cargo="")

def fields(data):
    return {k: ({"booleanValue": v} if isinstance(v, bool) else
                {"doubleValue": v} if isinstance(v, (int, float)) else {"stringValue": v})
            for k, v in data.items()}

def main():
    print("PTGamingSK Transport | ETS2 telemetria v1.1")
    if "--test" in sys.argv:
        print(json.dumps(sample(request(LOCAL_URL, local=True)), ensure_ascii=False, indent=2))
        return
    print("Zdieľa iba údaje z hry s riaditeľom. Ukončenie: Ctrl+C.")
    if input("Súhlasíš so zdieľaním hernej telemetrie? (ano): ").strip().lower() not in ("ano", "áno"):
        return
    email = input("E-mail vodiča: ").strip()
    password = getpass.getpass("Heslo vodiča: ")
    login = request("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key="+API_KEY,
                    {"email": email, "password": password, "returnSecureToken": True})
    del password
    uid, token, refresh = login["localId"], login["idToken"], login["refreshToken"]
    del login
    def check_member():
        profile = request(BASE+"/driverAccounts/"+urllib.parse.quote(uid, safe=""), token=token)
        if profile.get("fields", {}).get("enabled", {}).get("booleanValue") is not True:
            raise RuntimeError("Účet nie je povolený.")
    def publish(data):
        name = "projects/"+PROJECT+"/databases/(default)/documents/driverTelemetry/"+uid
        request(BASE+":commit", {"writes":[{"update":{"name":name,"fields":fields(data)},
                 "updateTransforms":[{"fieldPath":"updated","setToServerValue":"REQUEST_TIME"}]}]}, token)
    check_member()
    next_refresh = time.monotonic() + 3000
    try:
        while True:
            if time.monotonic() >= next_refresh:
                result = request("https://securetoken.googleapis.com/v1/token?key="+API_KEY,
                                 {"grant_type":"refresh_token","refresh_token":refresh}, form=True)
                token, refresh = result["id_token"], result["refresh_token"]
                next_refresh = time.monotonic() + 3000
            try:
                raw = request(LOCAL_URL, local=True)
                data = sample(raw)
            except (OSError, ValueError, TypeError, AttributeError):
                data = offline()
            try:
                publish(data)
                print("Odoslané:", data["truck"] if data["connected"] else "ETS2 odpojené")
            except urllib.error.HTTPError as error:
                if error.code in (401, 403):
                    print("Prístup zamietnutý; ukončujem.")
                    return
                print("Firestore dočasne nedostupný; ďalší pokus o 60 s.")
            except OSError:
                print("Sieť nedostupná; ďalší pokus o 60 s.")
            time.sleep(INTERVAL)
    except KeyboardInterrupt:
        try:
            publish(offline())
        except Exception:
            pass
        print("\nTelemetria ukončená.")

if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, RuntimeError) as error:
        print("Pripojenie sa nepodarilo. Skontroluj účet, pravidlá a sieť.", type(error).__name__)
