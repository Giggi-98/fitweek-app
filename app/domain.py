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
