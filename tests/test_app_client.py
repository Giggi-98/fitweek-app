"""App Android autonoma (1.9): accesso con token, CORS limitato alla sua origine, scritture ammesse."""
from .conftest import PASSWORD

APP = "http://localhost"


def app_login(client):
    r = client.post("/api/login", json={"password": PASSWORD, "client": "app"}, headers={"Origin": APP})
    assert r.status_code == 200 and "set-cookie" not in r.headers
    return {"Authorization": f"Bearer {r.json()['token']}", "Origin": APP}


def test_web_login_never_exposes_the_token(client):
    r = client.post("/api/login", json={"password": PASSWORD})
    assert r.status_code == 200 and "token" not in r.json() and "fitweek_session" in r.headers["set-cookie"]


def test_bearer_token_reads_and_writes(client):
    auth = app_login(client)
    client.cookies.clear()
    assert client.get("/api/state").status_code == 401
    state = client.get("/api/state", headers=auth)
    assert state.status_code == 200 and state.headers["access-control-allow-origin"] == APP
    put = client.put("/api/v1/sleep/2026-11-10", json={"bed_time": "00:10", "wake_time": "07:30"}, headers=auth)
    assert put.status_code == 200
    assert client.get("/api/state", headers={"Authorization": "Bearer falso", "Origin": APP}).status_code == 401


def test_logout_revokes_the_bearer_token(client):
    auth = app_login(client)
    client.cookies.clear()
    assert client.post("/api/logout", headers=auth).status_code == 200
    assert client.get("/api/state", headers=auth).status_code == 401


def test_cors_only_for_the_app_origin(client):
    pre = client.options("/api/state", headers={"Origin": APP, "Access-Control-Request-Method": "PUT",
                                                "Access-Control-Request-Headers": "authorization,content-type"})
    assert pre.status_code == 200 and pre.headers["access-control-allow-origin"] == APP
    assert "access-control-allow-credentials" not in pre.headers  # mai cookie tra origini diverse
    other = client.options("/api/state", headers={"Origin": "http://evil.example", "Access-Control-Request-Method": "PUT"})
    assert "access-control-allow-origin" not in other.headers
    auth = app_login(client)
    bad = client.put("/api/v1/sleep/2026-11-10", json={"bed_time": "00:10", "wake_time": "07:30"},
                     headers={**auth, "Origin": "http://evil.example"})
    assert bad.status_code == 403


def test_wrong_password_from_app_is_rate_limited_like_web(client):
    for _ in range(5):
        assert client.post("/api/login", json={"password": "sbagliata", "client": "app"}).status_code == 401
    assert client.post("/api/login", json={"password": PASSWORD, "client": "app"}).status_code == 429


def test_test_channel_apk_is_listed_separately(auth_client, settings):
    info = auth_client.get("/api/v1/app/android").json()
    assert info["available"] is False and info["next"] is None
    assert auth_client.get("/api/v1/app/android/download?channel=next").status_code == 404
    assert auth_client.get("/api/v1/app/android/download?channel=altro").status_code == 422


def test_sessions_list_single_revoke_and_sliding_renewal(client, settings):
    from datetime import datetime, timedelta
    from app.db import connect
    from app.security import SessionManager

    web = client.post("/api/login", json={"password": PASSWORD}, headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64)"})
    assert web.status_code == 200
    app_auth = app_login(client)

    # Elenco dei dispositivi: 2 sessioni, una marcata come corrente
    sessions_res = client.get("/api/v1/sessions", headers=app_auth)
    assert sessions_res.status_code == 200
    items = sessions_res.json()["items"]
    assert len(items) == 2 and sum(1 for s in items if s["current"]) == 1
    other_sid = next(s["id"] for s in items if not s["current"])
    my_sid = next(s["id"] for s in items if s["current"])

    # Rinnovo scorrevole: una sessione creata 40 giorni fa ma attiva 5 giorni fa resta valida
    old_created = (datetime.now().astimezone() - timedelta(days=40)).isoformat(timespec="seconds")
    recent_seen = (datetime.now().astimezone() - timedelta(days=5)).isoformat(timespec="seconds")
    with connect(settings.db_path) as c:
        c.execute("UPDATE sessions SET created_at=?, last_seen_at=? WHERE id=?", (old_created, recent_seen, my_sid))
    sm = SessionManager(settings)
    sm.RENEW_AFTER_S = 0  # forza l'emissione del token rinnovato
    _, renewed = sm.verify(app_auth["Authorization"].split()[1])
    assert renewed is not None

    # Una sessione inattiva da oltre 30 giorni viene rifiutata
    expired_seen = (datetime.now().astimezone() - timedelta(days=35)).isoformat(timespec="seconds")
    with connect(settings.db_path) as c:
        c.execute("UPDATE sessions SET last_seen_at=? WHERE id=?", (expired_seen, other_sid))
    assert client.get("/api/state").status_code == 401  # il cookie web apparteneva a other_sid

    # Revoca singola di un dispositivo
    app_auth2 = app_login(client)
    items2 = client.get("/api/v1/sessions", headers=app_auth2).json()["items"]
    assert len(items2) == 2
    assert client.delete(f"/api/v1/sessions/{my_sid}", headers=app_auth2).status_code == 200
    assert client.get("/api/state", headers=app_auth).status_code == 401
    assert client.get("/api/state", headers=app_auth2).status_code == 200
    assert client.delete("/api/v1/sessions/inesistente", headers=app_auth2).status_code == 404
