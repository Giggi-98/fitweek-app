"""Ricerca di prodotti su Open Food Facts (database pubblico, licenza ODbL) — D-018.

Il server invia al servizio SOLO il testo cercato (o il codice a barre letto dalla confezione): nessun cookie, nessun dato dell'utente, uno
User-Agent generico. I valori tornano per 100 g e vengono marcati con fonte "off": non sono né
stime dell'app né etichette verificate dall'utente. Disattivabile con FOOD_SEARCH=off.
"""
import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import OrderedDict, deque
from typing import Callable

from fastapi import APIRouter, Depends, HTTPException, Path, Query

from . import APP_VERSION
from .config import Settings

log = logging.getLogger("fitweek.foodsearch")
SEARCH_URL = "https://search.openfoodfacts.org/search"
PRODUCT_URL = "https://world.openfoodfacts.org/api/v2/product"
FIELDS = "code,product_name,brands,quantity,serving_quantity,nutriments"
ATTRIBUTION = "Open Food Facts (ODbL)"
MAX_PER_MINUTE = 10  # limite indicato da Open Food Facts per le ricerche
CACHE_SIZE = 200
TIMEOUT_S = 8


def _get(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": f"FitWeek/{APP_VERSION} (self-hosted personal app)"})
    with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:  # noqa: S310 - URL fisso https
        return json.load(response)


def fetch_json(query: str) -> dict:
    """Chiamata HTTP reale; nei test viene sostituita (monkeypatch)."""
    return _get(f"{SEARCH_URL}?{urllib.parse.urlencode({'q': query, 'page_size': 12, 'langs': 'it', 'fields': FIELDS})}")


def fetch_product(code: str) -> dict:
    """Scheda di un prodotto dal suo codice a barre; un codice sconosciuto risponde 404 (nessun prodotto).
    Nei test viene sostituita (monkeypatch)."""
    try:
        return _get(f"{PRODUCT_URL}/{code}?{urllib.parse.urlencode({'fields': FIELDS})}")
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return {}
        raise


def _number(value) -> float | None:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if 0 <= n < 10_000 else None


def parse_products(payload: dict) -> list[dict]:
    """Solo prodotti con nome e calorie per 100 g; valori implausibili scartati."""
    out, seen = [], set()
    for p in payload.get("hits") or payload.get("products") or []:
        name = str(p.get("product_name") or "").strip()
        nutriments = p.get("nutriments") or {}
        kcal = _number(nutriments.get("energy-kcal_100g"))
        if not name or kcal is None or kcal > 950:  # 900 kcal/100 g è il massimo fisico (grassi puri)
            continue
        brands = p.get("brands")
        names = brands if isinstance(brands, list) else str(brands or "").split(",")
        brand = ", ".join(str(b).strip() for b in names[:2] if str(b).strip())
        key = (name.lower(), brand.lower())
        if key in seen:
            continue
        seen.add(key)
        serving = _number(p.get("serving_quantity"))
        out.append({
            "code": str(p.get("code") or "")[:32],
            "name": name[:100],
            "brand": brand[:60],
            "kcal_100g": round(kcal, 1),
            "protein_100g": (lambda v: None if v is None else round(v, 1))(_number(nutriments.get("proteins_100g"))),
            "serving_g": serving if serving and serving <= 2000 else None,
        })
    return out[:10]


def build_router(settings: Settings, require_session: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/v1", dependencies=[Depends(require_session)])
    cache: OrderedDict[str, list[dict]] = OrderedDict()
    calls: deque[float] = deque()

    def lookup(key: str, fetch: Callable[[], dict]) -> list[dict]:
        """Risposta dalla memoria se c'è, altrimenti una chiamata esterna entro il limite al minuto."""
        if key in cache:
            cache.move_to_end(key)
            return cache[key]
        now = time.monotonic()
        while calls and now - calls[0] > 60:
            calls.popleft()
        if len(calls) >= MAX_PER_MINUTE:
            raise HTTPException(status_code=429, detail="Troppe ricerche online: riprova tra un minuto.")
        calls.append(now)
        try:
            items = parse_products(fetch())
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
            log.warning("ricerca prodotti non riuscita", extra={"fields": {"error": type(exc).__name__}})
            raise HTTPException(status_code=502, detail="Ricerca online non disponibile in questo momento.") from exc
        cache[key] = items
        if len(cache) > CACHE_SIZE:
            cache.popitem(last=False)
        return items

    @r.get("/food-search")
    def food_search(q: str = Query(min_length=3, max_length=60)):
        if not settings.food_search_enabled:
            return {"enabled": False, "items": [], "source": ATTRIBUTION}
        key = " ".join(q.lower().split())
        return {"enabled": True, "items": lookup(key, lambda: fetch_json(key)), "source": ATTRIBUTION}

    @r.get("/food-barcode/{code}")
    def food_barcode(code: str = Path(pattern=r"^\d{8,14}$")):
        """Prodotto dal codice a barre (EAN-8/13, UPC). `item` è null se il codice non è nel database o il
        prodotto non ha nome e calorie: in quel caso i valori si copiano a mano dall'etichetta."""
        if not settings.food_search_enabled:
            return {"enabled": False, "item": None, "source": ATTRIBUTION}
        items = lookup(f"barcode:{code}", lambda: {"products": [fetch_product(code).get("product") or {}]})
        return {"enabled": True, "item": items[0] if items else None, "source": ATTRIBUTION}

    return r
