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
