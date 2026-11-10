"""Sonno, note per esercizio, spesa reale, riferimenti del profilo, ricerca prodotti (1.8)."""
import urllib.error

from fastapi.testclient import TestClient

from app import domain, foodsearch
from app.main import create_app

from .conftest import PASSWORD, make_settings


def test_sleep_duration_and_average_across_midnight():
    assert domain.sleep_minutes("23:30", "07:00") == 450
    assert domain.sleep_minutes("02:00", "09:15") == 435
    assert domain.average_clock(["23:30", "00:30"]) == "00:00"
    assert domain.average_clock(["02:00", "00:00", "01:00"]) == "01:00"
    assert domain.average_clock([]) is None


def test_sleep_crud_and_summary(auth_client):
    assert auth_client.put("/api/v1/sleep/2026-11-10", json={"bed_time": "00:15", "wake_time": "07:45"}).json()["duration_min"] == 450
    auth_client.put("/api/v1/sleep/2026-11-11", json={"bed_time": "23:45", "wake_time": "07:15"})
    auth_client.put("/api/v1/sleep/2026-11-11", json={"bed_time": "23:45", "wake_time": "06:45", "note": "sveglia presto"})  # modifica
    out = auth_client.get("/api/v1/sleep?from=2026-11-09&to=2026-11-15").json()
    assert [n["date"] for n in out["items"]] == ["2026-11-10", "2026-11-11"]
    assert out["items"][1]["duration_min"] == 420 and out["items"][1]["note"] == "sveglia presto"
    assert out["summary"] == {"nights": 2, "duration_avg_min": 435, "bedtime_avg": "00:00"}
    weekly = auth_client.get("/api/v1/weekly-summary?week_start=2026-11-09").json()
    assert weekly["totals"]["sleep"]["nights"] == 2
    assert weekly["days"][1]["sleep"]["bed_time"] == "00:15" and weekly["days"][0]["sleep"] is None
    auth_client.delete("/api/v1/sleep/2026-11-10")
    assert len(auth_client.get("/api/v1/sleep?from=2026-11-09&to=2026-11-15").json()["items"]) == 1


def test_sleep_rejects_bad_input(auth_client):
    assert auth_client.put("/api/v1/sleep/2026-11-10", json={"bed_time": "25:00", "wake_time": "07:00"}).status_code == 422
    assert auth_client.put("/api/v1/sleep/2026-13-40", json={"bed_time": "23:00", "wake_time": "07:00"}).status_code == 422
    assert auth_client.get("/api/v1/sleep").status_code == 200


def test_exercise_notes(auth_client):
    assert auth_client.put("/api/v1/exercise-notes/a1", json={"note": " Sedile 4, presa larga "}).status_code == 200
    auth_client.put("/api/v1/exercise-notes/a2", json={"note": ""})
    assert auth_client.get("/api/v1/exercise-notes").json()["items"][0]["note"] == "Sedile 4, presa larga"
    assert len(auth_client.get("/api/v1/exercise-notes").json()["items"]) == 1
    assert auth_client.put("/api/v1/exercise-notes/a1%20x", json={"note": "x"}).status_code == 422


def test_grocery_spend_is_stored_per_week(auth_client):
    r = auth_client.put("/api/v1/grocery-spend/2026-11-11", json={"amount": 42.5})  # mercoledì → lunedì 9
    assert r.json()["week_start"] == "2026-11-09"
    auth_client.put("/api/v1/grocery-spend/2026-11-09", json={"amount": 44.9, "note": "con consegna"})
    auth_client.put("/api/v1/grocery-spend/2026-11-02", json={"amount": 38})
    items = auth_client.get("/api/v1/grocery-spend").json()["items"]
    assert [(i["week_start"], i["amount"]) for i in items] == [("2026-11-09", 44.9), ("2026-11-02", 38.0)]
    assert auth_client.put("/api/v1/grocery-spend/2026-11-09", json={"amount": -1}).status_code == 422
    auth_client.delete("/api/v1/grocery-spend/2026-11-02")
    assert len(auth_client.get("/api/v1/grocery-spend").json()["items"]) == 1


def test_profile_targets_are_optional_and_reported(auth_client):
    s = auth_client.get("/api/state").json()
    assert auth_client.get("/api/v1/weekly-summary").json()["targets"] == {"protein_g": None, "kcal": None}
    s["data"]["profile"].update(proteinTarget=130, kcalTarget=2100)
    s["data"]["groceries"][0]["recurring"] = True
    assert auth_client.put("/api/state", json=s).status_code == 200
    assert auth_client.get("/api/v1/weekly-summary").json()["targets"] == {"protein_g": 130, "kcal": 2100}
    s = auth_client.get("/api/state").json()
    s["data"]["profile"]["proteinTarget"] = "tanto"
    assert auth_client.put("/api/state", json=s).status_code == 422


def test_backup_v4_roundtrip_keeps_new_tables(auth_client):
    auth_client.put("/api/v1/sleep/2026-11-10", json={"bed_time": "00:15", "wake_time": "07:45"})
    auth_client.put("/api/v1/exercise-notes/a1", json={"note": "Sedile 4"})
    auth_client.put("/api/v1/grocery-spend/2026-11-09", json={"amount": 41})
    backup = auth_client.get("/api/backup").json()
    assert backup["format"] == "fitweek-backup-v4" and len(backup["sleep_logs"]) == 1
    auth_client.delete("/api/v1/sleep/2026-11-10")
    auth_client.put("/api/v1/exercise-notes/a1", json={"note": "cambiata"})
    assert auth_client.post("/api/v1/restore", json=backup).status_code == 200
    assert auth_client.get("/api/v1/sleep?from=2026-11-10&to=2026-11-10").json()["items"][0]["bed_time"] == "00:15"
    assert auth_client.get("/api/v1/exercise-notes").json()["items"][0]["note"] == "Sedile 4"
    assert auth_client.get("/api/v1/grocery-spend").json()["items"][0]["amount"] == 41
    # Un backup v3 (senza le tabelle nuove) non le tocca.
    old = {k: v for k, v in backup.items() if k not in ("sleep_logs", "exercise_notes", "grocery_spend")} | {"format": "fitweek-backup-v3"}
    assert auth_client.post("/api/v1/restore", json=old).status_code == 200
    assert len(auth_client.get("/api/v1/sleep?from=2026-11-10&to=2026-11-10").json()["items"]) == 1


# ---- ricerca prodotti (Open Food Facts), senza rete: fetch sostituito ----------------------------
OFF_PAYLOAD = {"hits": [
    {"code": "1", "product_name": "Yogurt greco bianco", "brands": ["Marca", "Altra", "Terza"], "serving_quantity": "150",
     "nutriments": {"energy-kcal_100g": 59, "proteins_100g": 10.04}},
    {"code": "2", "product_name": "Senza calorie", "nutriments": {}},
    {"code": "3", "product_name": "", "nutriments": {"energy-kcal_100g": 100}},
    {"code": "4", "product_name": "Valore assurdo", "nutriments": {"energy-kcal_100g": 5000}},
    {"code": "5", "product_name": "yogurt greco bianco", "brands": "Marca, Altra", "nutriments": {"energy-kcal_100g": 60}},
    {"code": "6", "product_name": "Skyr", "brands": "Latteria, X", "nutriments": {"energy-kcal_100g": "63", "proteins_100g": "n/d"}},
]}


def search_client(tmp_path, enabled=True):
    c = TestClient(create_app(make_settings(tmp_path, food_search_enabled=enabled)))
    assert c.post("/api/login", json={"password": PASSWORD}).status_code == 200
    return c


def test_food_search_parses_filters_and_caches(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(foodsearch, "fetch_json", lambda q: calls.append(q) or OFF_PAYLOAD)
    c = search_client(tmp_path)
    out = c.get("/api/v1/food-search?q=Yogurt%20  greco").json()
    assert out["enabled"] and "Open Food Facts" in out["source"]
    assert out["items"] == [
        {"code": "1", "name": "Yogurt greco bianco", "brand": "Marca, Altra", "kcal_100g": 59.0, "protein_100g": 10.0, "serving_g": 150.0},
        {"code": "6", "name": "Skyr", "brand": "Latteria, X", "kcal_100g": 63.0, "protein_100g": None, "serving_g": None},
    ]
    c.get("/api/v1/food-search?q=yogurt greco")
    assert calls == ["yogurt greco"]  # normalizzata e servita dalla cache la seconda volta


def test_food_search_disabled_errors_and_limits(tmp_path, monkeypatch):
    def boom(q):
        raise urllib.error.URLError("giù")
    monkeypatch.setattr(foodsearch, "fetch_json", boom)
    off = search_client(tmp_path / "a", enabled=False)
    assert off.get("/api/v1/food-search?q=pasta").json() == {"enabled": False, "items": [], "source": foodsearch.ATTRIBUTION}
    c = search_client(tmp_path / "b")
    assert c.get("/api/v1/food-search?q=pasta").status_code == 502
    assert c.get("/api/v1/food-search?q=pa").status_code == 422
    monkeypatch.setattr(foodsearch, "fetch_json", lambda q: {"hits": []})
    codes = [c.get(f"/api/v1/food-search?q=prodotto{i}").status_code for i in range(foodsearch.MAX_PER_MINUTE + 1)]
    assert codes[-1] == 429 and codes[0] == 200  # la chiamata fallita sopra conta nel limite
    assert TestClient(create_app(make_settings(tmp_path / "c"))).get("/api/v1/food-search?q=pasta").status_code == 401


def test_meal_with_off_items_keeps_database_source(auth_client):
    item = {"name": "Yogurt greco (150 g)", "category": "altro", "qty": 1, "kcal": 88.5, "protein_g": 15, "nutrition_source": "off"}
    r = auth_client.put("/api/v1/meal-logs/m-off", json={"date": "2026-11-10", "slot": "snack", "items": [item]})
    assert r.status_code == 200
    log = auth_client.get("/api/v1/meal-logs?from=2026-11-10&to=2026-11-10").json()["items"][0]
    assert log["nutrition_source"] == "off" and log["kcal"] == 88.5
    food = next(f for f in auth_client.get("/api/v1/foods").json()["items"] if f["name"] == "Yogurt greco (150 g)")
    assert food["nutrition_source"] == "off"  # il catalogo ricorda il prodotto con la sua fonte
