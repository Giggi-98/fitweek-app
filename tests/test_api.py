import copy

from app.config import Settings
from app.main import create_app
from fastapi.testclient import TestClient

from .conftest import PASSWORD


def test_health_is_public(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["ok"] is True


def test_protected_endpoints_require_login(client):
    for path in ("/api/state", "/api/backup", "/api/original-pdf"):
        assert client.get(path).status_code == 401


def test_wrong_password_is_401(client):
    assert client.post("/api/login", json={"password": "wrong"}).status_code == 401


def test_non_ascii_password_does_not_crash(client):
    assert client.post("/api/login", json={"password": "pàssword-è"}).status_code == 401


def test_malformed_bodies_are_4xx_not_500(auth_client):
    c = auth_client
    hdr = {"Content-Type": "application/json"}
    assert c.post("/api/login", content=b"not json", headers=hdr).status_code == 422
    assert c.post("/api/login", content=b"[]", headers=hdr).status_code == 422
    assert c.put("/api/state", content=b"not json", headers=hdr).status_code == 422
    assert c.put("/api/state", json={"version": 1}).status_code == 422


def test_rate_limit_after_repeated_failures(client):
    for _ in range(5):
        assert client.post("/api/login", json={"password": "nope"}).status_code == 401
    r = client.post("/api/login", json={"password": PASSWORD})
    assert r.status_code == 429 and int(r.headers["Retry-After"]) > 0


def test_logout_revokes_session(auth_client):
    token = auth_client.cookies.get("fitweek_session")
    assert auth_client.post("/api/logout").status_code == 200
    auth_client.cookies.set("fitweek_session", token)
    assert auth_client.get("/api/state").status_code == 401


def test_logout_all_revokes_every_session(settings):
    a = TestClient(create_app(settings))
    b = TestClient(create_app(settings))
    for c in (a, b):
        assert c.post("/api/login", json={"password": PASSWORD}).status_code == 200
    assert a.post("/api/logout-all").status_code == 200
    assert b.get("/api/state").status_code == 401


def test_forged_cookie_rejected(client):
    client.cookies.set("fitweek_session", "authorized.forged.value")
    assert client.get("/api/state").status_code == 401


def test_state_roundtrip_and_conflict(auth_client):
    s = auth_client.get("/api/state").json()
    r = auth_client.put("/api/state", json=s)
    assert r.status_code == 200 and r.json()["version"] == s["version"] + 1
    stale = auth_client.put("/api/state", json=s)
    assert stale.status_code == 409
    assert stale.headers["X-Current-Version"] == str(s["version"] + 1)


def test_foreign_origin_rejected(auth_client):
    s = auth_client.get("/api/state").json()
    r = auth_client.put("/api/state", json=s, headers={"Origin": "http://evil.example"})
    assert r.status_code == 403


def test_invalid_types_rejected(auth_client):
    s = auth_client.get("/api/state").json()
    bad = copy.deepcopy(s)
    bad["data"]["weights"] = [{"id": "w1", "date": "2026-11-09", "weight": "<img src=x onerror=alert(1)>"}]
    assert auth_client.put("/api/state", json=bad).status_code == 422
    bad = copy.deepcopy(s)
    bad["data"]["weights"] = [{"id": "w1", "date": "2026-10-34", "weight": 80}]
    assert auth_client.put("/api/state", json=bad).status_code == 422, "data inesistente"
    bad = copy.deepcopy(s)
    bad["data"]["routines"]["A"][0]["video"] = "javascript:alert(1)"
    assert auth_client.put("/api/state", json=bad).status_code == 422
    bad = copy.deepcopy(s)
    bad["data"]["groceries"][0]["id"] = '"><script>'
    assert auth_client.put("/api/state", json=bad).status_code == 422


def test_valid_workout_and_weight_accepted(auth_client):
    s = auth_client.get("/api/state").json()
    s["data"]["workouts"].append({
        "id": "3f1c2c1e-1111-4222-8333-444455556666", "routine": "A", "week": 1, "date": "2026-11-09",
        "duration": 90, "notes": "", "sets": [{"exerciseId": "a1", "set": 1, "kg": 40, "reps": 10}],
    })
    s["data"]["weights"].append({"id": "w1", "date": "2026-11-09", "weight": 89.4, "waist": None, "note": ""})
    assert auth_client.put("/api/state", json=s).status_code == 200


def test_oversized_state_rejected(tmp_path):
    from .conftest import make_settings
    c = TestClient(create_app(make_settings(tmp_path, max_state_bytes=10_000)))
    c.post("/api/login", json={"password": PASSWORD})
    s = c.get("/api/state").json()
    s["data"]["profile"]["notes"] = "x" * 5000
    s["data"]["meals"]["Lunedì"]["lunch"] = "y" * 1000
    s["data"]["inventory"] = [{"id": f"i{i}", "name": "z" * 100, "qty": "1", "expiry": ""} for i in range(50)]
    assert c.put("/api/state", json=s).status_code == 413


def test_security_headers(client):
    r = client.get("/")
    csp = r.headers["Content-Security-Policy"]
    assert "default-src 'self'" in csp
    assert "unsafe-inline" not in csp and "style-src 'self'" in csp
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert client.get("/api/health").headers["Cache-Control"] == "no-store"
    assert client.get("/static/js/main.js").headers["Cache-Control"] == "no-cache"


def test_backup_format(auth_client):
    r = auth_client.get("/api/backup")
    assert r.status_code == 200 and r.json()["format"] == "fitweek-backup-v4"
    assert "attachment" in r.headers["Content-Disposition"]


def _apk_client(tmp_path, with_apk):
    from .conftest import make_settings
    d = tmp_path / "dl"
    d.mkdir()
    if with_apk:
        (d / "fitweek.apk").write_bytes(b"PK\x03\x04fake")
        (d / "fitweek-apk.json").write_text('{"version": "1.4.0", "size": 8}')
    c = TestClient(create_app(make_settings(tmp_path, downloads_dir=d)))
    return c


def test_apk_download_requires_login_and_serves_file(tmp_path):
    c = _apk_client(tmp_path, True)
    assert c.get("/api/v1/app/android/download").status_code == 401
    c.post("/api/login", json={"password": PASSWORD})
    assert c.get("/api/v1/app/android").json() == {"available": True, "version": "1.4.0", "size": 8, "next": None}
    r = c.get("/api/v1/app/android/download")
    assert r.status_code == 200 and r.headers["content-type"] == "application/vnd.android.package-archive"
    assert 'fitweek-1.4.0.apk' in r.headers["content-disposition"] and r.content.startswith(b"PK")


def test_apk_missing(tmp_path):
    c = _apk_client(tmp_path, False)
    c.post("/api/login", json={"password": PASSWORD})
    assert c.get("/api/v1/app/android").json() == {"available": False, "next": None}
    assert c.get("/api/v1/app/android/download").status_code == 404


def test_frontend_has_no_inline_styles():
    """La CSP vieta gli attributi style: il frontend deve usare classi o data-* (ui.js applyDynamicStyles)."""
    from pathlib import Path

    static = Path(__file__).resolve().parent.parent / "static"
    offenders = [str(f.relative_to(static)) for f in [*static.rglob("*.js"), *static.rglob("*.html")]
                 if 'style="' in f.read_text(encoding="utf-8") or "<style" in f.read_text(encoding="utf-8")]
    assert offenders == []
