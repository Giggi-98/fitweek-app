"""Avvisi in tempo reale ai dispositivi collegati (1.15): `GET /api/v1/events` è un flusso Server-Sent Events.

Dopo ogni scrittura riuscita il server manda a tutti i dispositivi aperti quale dominio è cambiato e chi l'ha
cambiato (`X-Client-Id`, un numero a caso per pagina aperta, che serve solo a non ricaricare i propri dati). Il
flusso non porta mai dati: il dispositivo, avvisato, rilegge solo quel dominio con le API di sempre, che restano
la fonte. Un avviso perso non fa danni: al ritorno sull'app si rilegge comunque tutto.

Un solo processo uvicorn (Dockerfile): basta tenere gli iscritti in memoria.
"""
import asyncio
import json
import re
from collections.abc import AsyncIterator, Callable

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

MAX_SUBSCRIBERS = 20  # dispositivi e schede aperte insieme: per un utente solo è già moltissimo
QUEUE_SIZE = 50  # avvisi in attesa per iscritto; oltre, quelli vecchi si perdono (si rilegge comunque)
PING_S = 20  # commento periodico: tiene viva la connessione e ricontrolla la sessione
CLIENT_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

# Scritture che non cambiano i dati dell'utente: nessun avviso.
QUIET = {"login", "logout", "sessions", "events"}


def domain_of(path: str) -> str | None:
    """Dominio cambiato da una scrittura: `state` per lo stato a blob, `restore` per un ripristino, altrimenti
    il primo segmento dopo /api/v1/ (es. `workout-sessions`, `meal-logs`, `sleep`)."""
    if path == "/api/state":
        return "state"
    if path in ("/api/restore", "/api/v1/restore"):
        return "restore"
    m = re.match(r"^/api/v1/([a-z0-9-]+)", path)
    return m[1] if m and m[1] not in QUIET else None


class Hub:
    def __init__(self) -> None:
        self._subs: set[asyncio.Queue] = set()

    def publish(self, domain: str, by: str | None) -> None:
        event = {"domain": domain, "by": by}
        for q in list(self._subs):
            if q.full():
                q.get_nowait()
            q.put_nowait(event)

    def subscribe(self) -> asyncio.Queue:
        if len(self._subs) >= MAX_SUBSCRIBERS:
            raise HTTPException(status_code=429, detail="Troppi dispositivi collegati")
        q: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_SIZE)
        self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subs.discard(q)


def client_id(request: Request) -> str | None:
    value = request.headers.get("x-client-id", "")
    return value if CLIENT_ID.match(value) else None


def build_router(hub: Hub, require_session: Callable, still_valid: Callable[[Request], bool]) -> APIRouter:
    r = APIRouter(prefix="/api/v1")

    @r.get("/events", dependencies=[Depends(require_session)])
    async def events(request: Request):
        q = hub.subscribe()

        async def stream() -> AsyncIterator[str]:
            try:
                yield "retry: 3000\n: collegato\n\n"
                while not await request.is_disconnected():
                    try:
                        event = await asyncio.wait_for(q.get(), PING_S)
                    except asyncio.TimeoutError:
                        if not await asyncio.to_thread(still_valid, request):  # sessione revocata o scaduta: il flusso si chiude
                            return
                        yield ": ping\n\n"
                        continue
                    yield f"event: change\ndata: {json.dumps(event)}\n\n"
            finally:
                hub.unsubscribe(q)

        return StreamingResponse(stream(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})

    return r
