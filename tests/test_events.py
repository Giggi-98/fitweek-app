"""Avvisi in tempo reale (1.15): ogni scrittura riuscita avvisa i dispositivi collegati di quale dominio è cambiato."""
import pytest
from fastapi import HTTPException

from app.events import MAX_SUBSCRIBERS, Hub, domain_of


def drain(q):
    out = []
    while not q.empty():
        out.append(q.get_nowait())
    return out


def test_domain_of_write_paths():
    assert domain_of("/api/state") == "state"
    assert domain_of("/api/v1/restore") == "restore"
    assert domain_of("/api/v1/workout-sessions/abc/sets/a1/1") == "workout-sessions"
    assert domain_of("/api/v1/sleep/2026-11-10") == "sleep"
    assert domain_of("/api/v1/sessions/xyz") is None, "dispositivi collegati: non sono dati dell'utente"
    assert domain_of("/api/login") is None


def test_successful_write_notifies_with_the_writer_id_and_reads_or_failures_do_not(auth_client):
    q = auth_client.app.state.hub.subscribe()
    auth_client.put("/api/v1/sleep/2026-11-10", json={"bed_time": "00:00", "wake_time": "07:00"}, headers={"X-Client-Id": "tel-1"})
    auth_client.get("/api/v1/sleep")
    auth_client.put("/api/v1/sleep/2026-11-10", json={"bed_time": "99:00", "wake_time": "07:00"})  # 422
    auth_client.put("/api/v1/health-days/2026-11-10", json={"steps": 10}, headers={"X-Client-Id": "<script>"})
    assert drain(q) == [{"domain": "sleep", "by": "tel-1"}, {"domain": "health-days", "by": None}]


def test_events_need_a_session(client):
    assert client.get("/api/v1/events").status_code == 401


def test_full_queue_drops_the_oldest_and_too_many_devices_are_refused():
    hub = Hub()
    q = hub.subscribe()
    for i in range(60):
        hub.publish(f"d{i}", None)
    events = drain(q)
    assert len(events) == 50 and events[-1]["domain"] == "d59"
    for _ in range(MAX_SUBSCRIBERS - 1):
        hub.subscribe()
    with pytest.raises(HTTPException):
        hub.subscribe()
    hub.unsubscribe(q)
    hub.subscribe()  # un posto liberato si può riusare
