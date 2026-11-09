MON = "2026-11-09"

TRAY = [
    {"name": "Pasta (porzione mensa, senza salsa)", "category": "primo", "kcal": 330, "protein_g": 11, "nutrition_source": "estimate", "food_id": "f-pasta"},
    {"name": "Salsa all'amatriciana", "category": "salsa", "kcal": 140, "protein_g": 5, "nutrition_source": "estimate"},
    {"name": "Broccoli al vapore", "category": "contorno", "kcal": 45, "protein_g": 4},
    {"name": "Petto di pollo ai ferri", "category": "secondo", "kcal": 200, "protein_g": 35, "takeaway": True},
]


def test_composed_meal_totals_and_description(auth_client):
    lunch = [i for i in TRAY]  # il secondo resta nel vassoio ma è "da portare a casa"
    r = auth_client.put("/api/v1/meal-logs/m1", json={"date": MON, "slot": "lunch", "items": lunch}).json()
    # il secondo portato a casa NON conta nel pranzo: si conterà a cena
    assert r["kcal"] == 515 and r["protein_g"] == 20
    assert r["description"].startswith("Pasta") and r["description"].endswith("· a casa: Petto di pollo ai ferri")
    log = auth_client.get(f"/api/v1/meal-logs?from={MON}&to={MON}").json()["items"][0]
    assert len(log["items"]) == 4 and log["nutrition_source"] == "estimate"


def test_quantity_multiplies_and_edit_recalculates(auth_client):
    pane = {"name": "Pane, pagnottina (~100 g)", "category": "pane", "kcal": 270, "protein_g": 9, "qty": 2}
    r = auth_client.put("/api/v1/meal-logs/m2", json={"date": MON, "slot": "dinner", "items": [pane]}).json()
    assert r["kcal"] == 540 and r["description"] == "2× Pane, pagnottina (~100 g)"
    # modifica successiva: 1,5 pagnottine e cambio pasto → ricalcolo
    pane["qty"] = 1.5
    r = auth_client.put("/api/v1/meal-logs/m2", json={"date": MON, "slot": "snack", "items": [pane]}).json()
    assert r["kcal"] == 405
    log = auth_client.get(f"/api/v1/meal-logs?from={MON}&to={MON}").json()["items"][0]
    assert log["slot"] == "snack" and log["kcal"] == 405
    w = auth_client.get(f"/api/v1/weekly-summary?week_start={MON}").json()
    assert w["days"][0]["kcal_estimate"] == 405


def test_items_without_values(auth_client):
    r = auth_client.put("/api/v1/meal-logs/m3", json={"date": MON, "slot": "lunch", "items": [{"name": "Piatto misterioso"}]}).json()
    assert r["kcal"] is None
    r = auth_client.put("/api/v1/meal-logs/m3", json={"date": MON, "slot": "lunch", "items": [
        {"name": "Piatto misterioso"}, {"name": "Mela", "category": "frutta", "kcal": 80, "nutrition_source": "label"}]}).json()
    assert r["kcal"] == 80


def test_catalog_learns_new_dishes(auth_client):
    before = {f["name"]: f for f in auth_client.get("/api/v1/foods").json()["items"]}
    assert "Pane, pagnottina (~100 g)" in before and before["Mela"]["nutrition_source"] == "estimate"
    auth_client.put("/api/v1/meal-logs/m4", json={"date": MON, "slot": "lunch", "items": [
        {"name": "Scaloppina al pom. fresco", "category": "secondo", "kcal": 270}, {"name": "Mela", "category": "frutta", "kcal": 80}]})
    after = {f["name"]: f for f in auth_client.get("/api/v1/foods").json()["items"]}
    assert after["Scaloppina al pom. fresco"]["category"] == "secondo" and after["Scaloppina al pom. fresco"]["kcal"] == 270
    assert after["Mela"]["use_count"] == before["Mela"]["use_count"] + 1
    assert after["Scaloppina al pom. fresco"]["nutrition_source"] == "manual"


def test_food_crud_and_duplicate_name(auth_client):
    assert auth_client.put("/api/v1/foods/f-mela", json={"category": "frutta", "name": "Mela", "kcal": 72, "nutrition_source": "label"}).status_code == 200
    assert next(f for f in auth_client.get("/api/v1/foods").json()["items"] if f["id"] == "f-mela")["kcal"] == 72
    assert auth_client.put("/api/v1/foods/f-altro", json={"category": "frutta", "name": "mela"}).status_code == 409
    assert auth_client.put("/api/v1/foods/f-x", json={"category": "bibita", "name": "x"}).status_code == 422
    assert auth_client.delete("/api/v1/foods/f-mela").status_code == 200
    assert all(f["id"] != "f-mela" for f in auth_client.get("/api/v1/foods").json()["items"])


def test_takeaway_for_dinner(auth_client):
    auth_client.put("/api/v1/meal-logs/m5", json={"date": MON, "slot": "lunch", "items": TRAY})
    t = auth_client.get(f"/api/v1/takeaway?date={MON}").json()
    assert [i["name"] for i in t["items"]] == ["Petto di pollo ai ferri"]


def test_item_validation(auth_client):
    bad = [{"name": "x", "qty": 0}, {"name": "", "kcal": 1}, {"name": "x", "kcal": -1}, {"name": "x", "category": "zuppa"}]
    for item in bad:
        assert auth_client.put("/api/v1/meal-logs/m6", json={"date": MON, "slot": "lunch", "items": [item]}).status_code == 422


def test_pane_template_for_dinner(auth_client):
    t = {x["id"]: x for x in auth_client.get("/api/v1/meal-templates").json()["items"]}
    assert t["t-secondo-pane2"]["kcal"] == 840 and t["t-secondo-pane2"]["slot"] == "dinner"


def test_backup_roundtrip_keeps_items_and_foods(auth_client):
    auth_client.put("/api/v1/meal-logs/m7", json={"date": MON, "slot": "lunch", "items": TRAY})
    auth_client.put("/api/v1/foods/f-custom", json={"category": "secondo", "name": "Spezzatino", "kcal": 380})
    b = auth_client.get("/api/backup").json()
    assert b["meal_logs"][0]["items"][3]["takeaway"] is True and any(f["name"] == "Spezzatino" for f in b["foods"])
    auth_client.delete("/api/v1/foods/f-custom")
    auth_client.delete("/api/v1/meal-logs/m7")
    assert auth_client.post("/api/v1/restore", json=b).status_code == 200
    log = auth_client.get(f"/api/v1/meal-logs?from={MON}&to={MON}").json()["items"][0]
    assert len(log["items"]) == 4 and log["kcal"] == 515
    assert any(f["name"] == "Spezzatino" for f in auth_client.get("/api/v1/foods").json()["items"])
