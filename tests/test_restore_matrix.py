"""Contratto del ripristino da backup JSON (FW-ARCH-001): per ogni formato, quali domini vengono sostituiti e
quali restano com'erano. Ogni dominio ha un dato "sentinella" scritto DOPO il backup: se dopo il ripristino c'è
ancora, il dominio è stato tenuto; se non c'è più, è stato sostituito con il contenuto del backup."""
import pytest

from .test_workouts import SID, new_session

DAY = "2026-11-10"
WEEK = "2026-11-09"
ALWAYS = ["state", "workouts"]
V3 = ["meal_templates", "meal_logs", "reminders", "foods"]
V4 = ["sleep_logs", "exercise_notes", "grocery_spend"]
# formato → campi presenti nel file oltre a stato e sedute
FORMATS = {"fitweek-backup-v1": [], "fitweek-backup-v2": [], "fitweek-backup-v3": V3, "fitweek-backup-v4": V3 + V4}


def write_all(c, tag: str) -> None:
    """Un dato riconoscibile (`tag`) in ogni dominio."""
    state = c.get("/api/state").json()
    state["data"]["profile"]["name"] = tag
    assert c.put("/api/state", json={"version": state["version"], "data": state["data"]}).status_code == 200
    c.put(f"/api/v1/workout-sessions/{SID}/sets/a1/1", json={"kg": 40, "reps": 10})
    assert c.put(f"/api/v1/meal-templates/t-{tag}", json={"slot": "lunch", "name": tag}).status_code == 200
    assert c.put(f"/api/v1/meal-logs/m-{tag}", json={"date": DAY, "slot": "lunch", "description": tag}).status_code == 200
    assert c.put(f"/api/v1/reminders/r-{tag}", json={"weekday": 0, "time": "10:00", "kind": "custom", "action": "none",
                                                     "title": tag, "enabled": False}).status_code == 200
    assert c.put(f"/api/v1/reminders/r-{tag}/ack", json={"date": DAY, "status": "done"}).status_code == 200
    assert c.put(f"/api/v1/foods/f-{tag}", json={"category": "altro", "name": tag}).status_code == 200
    assert c.put(f"/api/v1/sleep/{DAY}", json={"bed_time": "00:10", "wake_time": "07:30", "note": tag}).status_code == 200
    assert c.put("/api/v1/exercise-notes/a1", json={"note": tag}).status_code == 200
    assert c.put(f"/api/v1/grocery-spend/{WEEK}", json={"amount": 40, "note": tag}).status_code == 200


def tags(c) -> dict[str, bool]:
    """Per ogni dominio: il dato che c'è adesso è quello scritto dopo il backup ("dopo")?"""
    has = lambda items, key="name": any(x.get(key) == "dopo" for x in items)  # noqa: E731
    return {
        "state": c.get("/api/state").json()["data"]["profile"]["name"] == "dopo",
        "workouts": any(s["id"] == "s-dopo" for s in c.get("/api/v1/workout-sessions").json()["items"]),
        "meal_templates": has(c.get("/api/v1/meal-templates").json()["items"]),
        "meal_logs": has(c.get(f"/api/v1/meal-logs?from={DAY}&to={DAY}").json()["items"], "description"),
        "reminders": has(c.get("/api/v1/reminders").json()["items"], "title"),
        "foods": has(c.get("/api/v1/foods").json()["items"]),
        "sleep_logs": has(c.get(f"/api/v1/sleep?from={DAY}&to={DAY}").json()["items"], "note"),
        "exercise_notes": has(c.get("/api/v1/exercise-notes").json()["items"], "note"),
        "grocery_spend": has(c.get("/api/v1/grocery-spend").json()["items"], "note"),
    }


@pytest.mark.parametrize("fmt", FORMATS)
def test_restore_replaces_only_the_domains_in_the_file_and_says_so(auth_client, fmt):
    new_session(auth_client)
    write_all(auth_client, "prima")
    full = auth_client.get("/api/backup").json()
    present = FORMATS[fmt]
    backup = {k: full[k] for k in ("version", "data", "workout_sessions", *present)} | {"format": fmt}
    if fmt == "fitweek-backup-v1":
        del backup["workout_sessions"]  # nel v1 le sedute stavano dentro data.workouts (qui vuoto)

    write_all(auth_client, "dopo")
    auth_client.post("/api/v1/workout-sessions", json={"id": "s-dopo", "routine": "B", "week": 1, "date": DAY})
    assert all(tags(auth_client).values()), "premessa: ogni dominio ora contiene il dato scritto dopo il backup"

    r = auth_client.post("/api/v1/restore", json=backup)
    assert r.status_code == 200
    out = r.json()
    assert out["replaced"] == ALWAYS + present
    assert out["kept"] == [d for d in V3 + V4 if d not in present]
    after = tags(auth_client)
    assert {d for d, still_new in after.items() if not still_new} == set(out["replaced"]), after
    assert {d for d, still_new in after.items() if still_new} == set(out["kept"]), after


def test_restore_field_presence_decides_not_the_format_label(auth_client):
    """Un file v4 a cui manca un campo (o lo ha a null) tiene quel dominio; un campo presente ma vuoto lo svuota."""
    new_session(auth_client)
    write_all(auth_client, "prima")
    backup = auth_client.get("/api/backup").json()
    del backup["sleep_logs"]
    backup["exercise_notes"] = None
    backup["grocery_spend"] = []
    out = auth_client.post("/api/v1/restore", json=backup).json()
    assert out["kept"] == ["sleep_logs", "exercise_notes"] and "grocery_spend" in out["replaced"]
    assert len(auth_client.get(f"/api/v1/sleep?from={DAY}&to={DAY}").json()["items"]) == 1
    assert auth_client.get("/api/v1/exercise-notes").json()["items"][0]["note"] == "prima"
    assert auth_client.get("/api/v1/grocery-spend").json()["items"] == []


def test_restore_reminder_acks_follow_reminders(auth_client, settings):
    """Le risposte ai promemoria (fatto / non oggi) non sono nel backup: vengono azzerate quando i promemoria
    sono sostituiti e restano quando i promemoria restano."""
    import sqlite3
    count = lambda: sqlite3.connect(settings.db_path).execute("SELECT COUNT(*) FROM reminder_acks").fetchone()[0]  # noqa: E731
    new_session(auth_client)
    write_all(auth_client, "prima")
    backup = auth_client.get("/api/backup").json()
    assert count() == 1
    v2 = {k: backup[k] for k in ("version", "data", "workout_sessions")} | {"format": "fitweek-backup-v2"}
    assert auth_client.post("/api/v1/restore", json=v2).status_code == 200
    assert count() == 1, "promemoria non nel file: restano, con le loro risposte"
    assert auth_client.post("/api/v1/restore", json=backup).status_code == 200
    assert count() == 0, "promemoria sostituiti: le risposte, che il backup non contiene, vengono azzerate"


def test_restore_rolls_back_completely_when_a_domain_fails(auth_client):
    """Un file con due notti nella stessa data viola la chiave primaria a metà ripristino, dopo che blob e
    sedute sono già stati riscritti: la transazione annulla TUTTO e il server risponde 422, non 500."""
    new_session(auth_client)
    write_all(auth_client, "prima")
    backup = auth_client.get("/api/backup").json()
    backup["sleep_logs"] = [
        {"date": DAY, "bed_time": "23:00", "wake_time": "07:00", "source": "manual", "note": "prima"},
        {"date": DAY, "bed_time": "23:30", "wake_time": "07:30", "source": "manual", "note": "duplicata"},
    ]
    before = auth_client.get("/api/backup").json()
    r = auth_client.post("/api/v1/restore", json=backup)
    assert r.status_code == 422, "input malformato → errore 4xx esplicito, mai 500"
    assert auth_client.get("/api/backup").json() == before, "nessun dominio cambiato: il ripristino è atomico"
