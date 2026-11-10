"""Regole di dominio pure (senza I/O), testate in tests/test_domain.py."""
from datetime import date, timedelta

PROGRAM_WEEKS = 8
# Giorno della settimana (lunedì=0) → giornata della scheda. Fonte: routine dell'utente (CLAUDE.md).
SCHEDULE = {0: "A", 2: "B", 4: "C"}


def program_week(start: date, today: date, weeks: int = PROGRAM_WEEKS) -> int:
    """Settimana del programma (1..weeks) contando a blocchi di 7 giorni da `start`.

    Prima dell'inizio restituisce 1; dopo la fine resta sull'ultima settimana.
    """
    elapsed = (today - start).days
    return min(weeks, max(1, elapsed // 7 + 1))


def start_date_for_week(week: int, today: date) -> date:
    """Data di inizio tale che `today` cada nella settimana `week` (inizio = lunedì)."""
    monday = today - timedelta(days=today.weekday())
    return monday - timedelta(weeks=week - 1)


def routine_for(day: date) -> str | None:
    return SCHEDULE.get(day.weekday())


def planned_sets(sets_by_week: list[int], week: int) -> int:
    if not sets_by_week:
        return 0
    return sets_by_week[min(week, len(sets_by_week)) - 1]


def _minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def sleep_minutes(bed_time: str, wake_time: str) -> int:
    """Durata del sonno tra due orari HH:MM; se il risveglio è "prima" si intende il giorno dopo."""
    return (_minutes(wake_time) - _minutes(bed_time)) % (24 * 60)


def average_clock(times: list[str]) -> str | None:
    """Media di orari serali/notturni. Gli orari sono contati da mezzogiorno, così 23:30 e 00:30
    danno 00:00 (e non 12:00 come farebbe una media aritmetica semplice)."""
    if not times:
        return None
    shifted = [(_minutes(t) - 12 * 60) % (24 * 60) for t in times]
    avg = (round(sum(shifted) / len(shifted)) + 12 * 60) % (24 * 60)
    return f"{avg // 60:02d}:{avg % 60:02d}"
