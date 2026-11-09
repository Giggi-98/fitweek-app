"""Validazione dello stato applicativo (formato blob v1).

I modelli rifiutano campi sconosciuti: se il frontend aggiunge un campo, va aggiunto qui
(e in docs/DATA_MODEL.md). I limiti sono larghi per non rifiutare dati legittimi, ma
impediscono tipi errati (es. HTML al posto di un numero) e payload anomali.
"""
from typing import Annotated, Any, Optional

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

Id = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,64}$")]
Key = Annotated[str, StringConstraints(min_length=1, max_length=20)]
IsoDate = Annotated[str, StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}$")]
OptIsoDate = Annotated[str, StringConstraints(pattern=r"^(\d{4}-\d{2}-\d{2})?$")]
HttpsUrl = Annotated[str, StringConstraints(pattern=r"^(https://[^\s\"'<>]{1,300})?$")]


def Text(max_length: int) -> Any:  # noqa: N802 - alias di tipo
    return Annotated[str, StringConstraints(max_length=max_length)]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Profile(Strict):
    name: Text(100) = ""
    age: float = Field(ge=0, le=120)
    height: float = Field(ge=0, le=260)
    startingWeight: float = Field(ge=0, le=500)
    budget: float = Field(ge=0, le=100_000)
    week: int = Field(ge=1, le=52)
    startDate: IsoDate
    gymDays: list[Text(20)] = Field(default_factory=list, max_length=7)
    notes: Text(5000) = ""


class Exercise(Strict):
    id: Id
    name: Text(120)
    reps: Text(20)
    sets: list[Annotated[int, Field(ge=0, le=20)]] = Field(min_length=1, max_length=52)
    video: HttpsUrl = ""


class WorkoutSet(Strict):
    exerciseId: Id
    set: int = Field(ge=1, le=50)
    kg: float = Field(ge=0, le=1000)
    reps: int = Field(ge=0, le=500)


class Workout(Strict):
    id: Id
    routine: Key
    week: int = Field(ge=1, le=52)
    date: IsoDate
    duration: Optional[float] = Field(default=None, ge=0, le=1440)
    sets: list[WorkoutSet] = Field(max_length=500)
    notes: Text(5000) = ""


class WeightReading(Strict):
    id: Id
    date: IsoDate
    weight: float = Field(gt=0, le=500)
    waist: Optional[float] = Field(default=None, ge=0, le=300)
    note: Text(500) = ""


class MealDay(Strict):
    lunch: Text(1000) = ""
    pre: Text(1000) = ""
    dinner: Text(1000) = ""


class GroceryItem(Strict):
    id: Id
    name: Text(120)
    qty: Text(60)
    price: float = Field(ge=0, le=10_000)
    checked: bool = False
    category: Text(40) = "Altro"


class InventoryItem(Strict):
    id: Id
    name: Text(120)
    qty: Text(60)
    expiry: OptIsoDate = ""


class AppState(Strict):
    profile: Profile
    routines: dict[Key, list[Exercise]] = Field(max_length=20)
    workouts: list[Workout] = Field(max_length=10_000)
    weights: list[WeightReading] = Field(max_length=20_000)
    meals: dict[Key, MealDay] = Field(max_length=7)
    groceries: list[GroceryItem] = Field(max_length=500)
    inventory: list[InventoryItem] = Field(max_length=1000)
    habits: dict[str, Any] = Field(default_factory=dict)
    notes: list[Any] = Field(default_factory=list)
    appVersion: int = 1


class StatePut(Strict):
    version: int = Field(ge=1)
    data: AppState


class LoginBody(Strict):
    password: Text(256)


# ---- API v1: allenamenti -------------------------------------------------------------------
from typing import Literal  # noqa: E402

IsoDateTime = Annotated[str, StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?([+-]\d{2}:\d{2}|Z)?$")]
SessionStatus = Literal["in_progress", "done", "skipped"]


class SessionCreate(Strict):
    id: Id
    routine: Key
    week: int = Field(ge=1, le=52)
    date: IsoDate


class SessionPatch(Strict):
    status: Optional[SessionStatus] = None
    routine: Optional[Key] = None
    week: Optional[int] = Field(default=None, ge=1, le=52)
    date: Optional[IsoDate] = None
    ended_at: Optional[IsoDateTime] = None
    duration_min: Optional[float] = Field(default=None, ge=0, le=1440)
    cardio_min: Optional[float] = Field(default=None, ge=0, le=300)
    notes: Optional[Text(5000)] = None


class SetLogPut(Strict):
    kg: Optional[float] = Field(default=None, ge=0, le=1000)
    reps: Optional[int] = Field(default=None, ge=0, le=500)
    rir: Optional[int] = Field(default=None, ge=0, le=10)
    completed: bool = True


class ProgramWeekPut(Strict):
    week: int = Field(ge=1, le=52)


class BackupRestore(BaseModel):
    """Backup v1 (solo stato) o v2 (stato + sedute). Le sedute sono validate qui sotto."""
    model_config = ConfigDict(extra="ignore")
    format: Literal["fitweek-backup-v1", "fitweek-backup-v2", "fitweek-backup-v3"]
    data: AppState
    workout_sessions: list["BackupSession"] = Field(default_factory=list, max_length=10_000)
    # v3: assenti nei backup precedenti → None = non toccare le tabelle esistenti
    meal_templates: Optional[list["BackupMealTemplate"]] = Field(default=None, max_length=2000)
    meal_logs: Optional[list["BackupMealLog"]] = Field(default=None, max_length=50_000)
    reminders: Optional[list["BackupReminder"]] = Field(default=None, max_length=500)


class BackupSet(Strict):
    exercise_id: Id
    set_index: int = Field(ge=1, le=50)
    kg: Optional[float] = Field(default=None, ge=0, le=1000)
    reps: Optional[int] = Field(default=None, ge=0, le=500)
    rir: Optional[int] = Field(default=None, ge=0, le=10)
    completed: bool = True
    logged_at: Text(40)


class BackupSession(Strict):
    id: Id
    routine: Key
    week: int = Field(ge=1, le=52)
    date: IsoDate
    status: SessionStatus
    started_at: Optional[Text(40)] = None
    ended_at: Optional[Text(40)] = None
    duration_min: Optional[float] = Field(default=None, ge=0, le=1440)
    cardio_min: Optional[float] = Field(default=None, ge=0, le=300)
    notes: Text(5000) = ""
    source: Text(20) = "app"
    created_at: Text(40)
    updated_at: Text(40)
    sets: list[BackupSet] = Field(default_factory=list, max_length=500)





# ---- API v1: pasti e promemoria (M4) -------------------------------------------------------
MealSlot = Literal["lunch", "snack", "pre_workout", "dinner", "other"]
NutritionSource = Literal["estimate", "label", "manual"]
HHMM = Annotated[str, StringConstraints(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")]
ReminderKind = Literal["meal", "workout", "weigh_in", "shopping", "sleep", "custom"]
ReminderAction = Literal["log_meal", "start_workout", "log_weight", "open_shopping", "none"]


class MealTemplatePut(Strict):
    slot: MealSlot
    name: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    kcal: Optional[float] = Field(default=None, ge=0, le=5000)
    protein_g: Optional[float] = Field(default=None, ge=0, le=500)
    nutrition_source: Optional[NutritionSource] = None
    nutrition_note: Text(300) = ""
    position: int = Field(default=0, ge=0, le=10_000)


class MealLogPut(Strict):
    date: IsoDate
    slot: MealSlot
    status: Literal["eaten", "skipped"] = "eaten"
    description: Text(300) = ""
    template_id: Optional[Id] = None
    kcal: Optional[float] = Field(default=None, ge=0, le=5000)
    protein_g: Optional[float] = Field(default=None, ge=0, le=500)
    nutrition_source: Optional[NutritionSource] = None
    note: Text(500) = ""


class ReminderPut(Strict):
    weekday: int = Field(ge=0, le=6)
    time: HHMM
    kind: ReminderKind
    slot: Optional[MealSlot] = None
    title: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    action: ReminderAction = "none"
    enabled: bool = True


class ReminderAck(Strict):
    date: IsoDate
    status: Literal["done", "dismissed", "snoozed"]
    snooze_minutes: Optional[int] = Field(default=None, ge=1, le=240)


class _Stamps(BaseModel):
    model_config = ConfigDict(extra="ignore")  # tollera colonne aggiunte in futuro


class BackupMealTemplate(_Stamps, MealTemplatePut):
    model_config = ConfigDict(extra="ignore")
    id: Id
    nutrition_note: Optional[Text(300)] = ""


class BackupMealLog(_Stamps, MealLogPut):
    model_config = ConfigDict(extra="ignore")
    id: Id
    logged_at: Text(40)


class BackupReminder(_Stamps, ReminderPut):
    model_config = ConfigDict(extra="ignore")
    id: Id


BackupRestore.model_rebuild()
