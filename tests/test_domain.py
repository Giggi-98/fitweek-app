from datetime import date

from app import domain


def test_program_week_boundaries():
    start = date(2026, 11, 9)  # lunedì
    assert domain.program_week(start, date(2026, 11, 1)) == 1   # prima dell'inizio
    assert domain.program_week(start, date(2026, 11, 9)) == 1
    assert domain.program_week(start, date(2026, 11, 15)) == 1  # domenica stessa settimana
    assert domain.program_week(start, date(2026, 11, 16)) == 2
    assert domain.program_week(start, date(2026, 12, 28)) == 8
    assert domain.program_week(start, date(2027, 3, 1)) == 8    # dopo la fine


def test_start_date_for_week_roundtrip():
    today = date(2026, 11, 25)  # mercoledì
    for week in range(1, 9):
        start = domain.start_date_for_week(week, today)
        assert start.weekday() == 0
        assert domain.program_week(start, today) == week


def test_routine_for():
    assert domain.routine_for(date(2026, 11, 9)) == "A"
    assert domain.routine_for(date(2026, 11, 10)) is None
    assert domain.routine_for(date(2026, 11, 11)) == "B"
    assert domain.routine_for(date(2026, 11, 13)) == "C"
    assert domain.routine_for(date(2026, 11, 14)) is None


def test_planned_sets():
    assert domain.planned_sets([3, 3, 3, 3, 4, 4, 4, 4], 5) == 4
    assert domain.planned_sets([3, 4], 8) == 4
    assert domain.planned_sets([], 1) == 0
