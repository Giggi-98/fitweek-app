"""Validazione dello stato applicativo (formato blob v1).

I modelli rifiutano campi sconosciuti: se il frontend aggiunge un campo, va aggiunto qui
(e in docs/DATA_MODEL.md). I limiti sono larghi per non rifiutare dati legittimi, ma
impediscono tipi errati (es. HTML al posto di un numero) e payload anomali.
"""
from datetime import date as _date
from typing import Annotated, Any, Literal, Optional

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, model_validator


def _real_date(v: str) -> str:
    """Il formato da solo non basta: rifiuta date inesistenti come 2026-10-34."""
    if v:
        _date.fromisoformat(v)
    return v

Id = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,64}$")]
Key = Annotated[str, StringConstraints(min_length=1, max_length=20)]
IsoDate = Annotated[str, StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}$"), AfterValidator(_real_date)]
OptIsoDate = Annotated[str, StringConstraints(pattern=r"^(\d{4}-\d{2}-\d{2})?$"), AfterValidator(_real_date)]
HttpsUrl = Annotated[str, StringConstraints(pattern=r"^(https://[^\s\"'<>]{1,300})?$")]


def Text(max_length: int) -> Any:  # noqa: N802 - alias di tipo
    return Annotated[str, StringConstraints(max_length=max_length)]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ProteinPowder(Strict):
    """Proteine in polvere dell'utente. Valori PER MISURINO, copiati dall'etichetta: l'app non li stima."""
    name: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    scoopG: Optional[float] = Field(default=None, gt=0, le=200)
    proteinG: Optional[float] = Field(default=None, ge=0, le=200)
    kcal: Optional[float] = Field(default=None, ge=0, le=1000)
    source: Literal["label", "off"] = "label"  # off = valori letti da Open Food Facts dal codice a barre


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
    # Riferimenti giornalieri scelti dall'utente (mai calcolati né prescritti dall'app).
    proteinTarget: Optional[float] = Field(default=None, ge=0, le=500)
    kcalTarget: Optional[float] = Field(default=None, ge=0, le=10_000)
    proteinPowder: Optional[ProteinPowder] = None


class Exercise(Strict):
    id: Id
    name: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    reps: Text(20)
    sets: list[Annotated[int, Field(ge=0, le=20)]] = Field(min_length=1, max_length=52)
    video: HttpsUrl = ""
    # Scelti dall'utente nell'editor della scheda (1.13); assenti negli esercizi del PDF mai modificati.
    rest: Optional[int] = Field(default=None, ge=15, le=600)  # recupero in secondi; None = quello predefinito
    muscle: Text(30) = ""


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
    source: Literal["manual", "health_connect"] = "manual"  # health_connect = dalla bilancia, via Health Connect


class PlanIngredient(Strict):
    name: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    amount: float = Field(gt=0, le=100_000)
    unit: Text(20) = "g"
    category: Text(40) = "Altro"
    slot: Literal["lunch", "pre", "dinner"] = "dinner"


class MealDay(Strict):
    lunch: Text(1000) = ""
    pre: Text(1000) = ""
    dinner: Text(1000) = ""
    items: list[PlanIngredient] = Field(default_factory=list, max_length=40)


class GroceryItem(Strict):
    id: Id
    name: Text(120)
    qty: Text(60)
    amount: Optional[float] = Field(default=None, ge=0, le=100_000)
    unit: Text(20) = ""
    price: Optional[float] = Field(default=0, ge=0, le=10_000)
    checked: bool = False
    category: Text(40) = "Altro"
    recurring: bool = False  # si compra ogni settimana: resta in lista dopo la consegna


class InventoryItem(Strict):
    id: Id
    name: Text(120)
    qty: Text(60)
    amount: Optional[float] = Field(default=None, ge=0, le=100_000)
    unit: Text(20) = ""
    expiry: OptIsoDate = ""


class AppState(Strict):
    profile: Profile
    routines: dict[Key, list[Exercise]] = Field(max_length=20)
    workouts: list[Workout] = Field(max_length=10_000)
    # Esercizi usati in passato e non più in una giornata (tolti, sostituiti, usati solo in una seduta):
    # servono a dare un nome allo storico e a riproporli quando se ne aggiunge uno.
    exerciseArchive: list[Exercise] = Field(default_factory=list, max_length=300)
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
    # "app": l'app Android autonoma non può usare il cookie (origine diversa) e riceve il token nel corpo.
    client: Literal["web", "app"] = "web"


# ---- API v1: allenamenti -------------------------------------------------------------------
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


HeartPoint = Annotated[list[int], Field(min_length=3, max_length=3)]  # [secondi dall'inizio, media, massimo]


class WorkoutHeartPut(Strict):
    """Battito durante una seduta, riassunto sul telefono dai campioni dell'orologio (Health Connect).
    `curve`: un punto ogni 30 s (1.17), per il grafico della seduta e il picco di ogni serie."""
    avg_bpm: int = Field(ge=30, le=230)
    max_bpm: int = Field(ge=30, le=240)
    samples: int = Field(ge=1, le=100_000)
    curve: Optional[list[HeartPoint]] = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def _consistent(self) -> "WorkoutHeartPut":
        if self.avg_bpm > self.max_bpm:
            raise ValueError("il battito medio supera il massimo")
        for sec, avg, peak in self.curve or []:
            if not (0 <= sec <= 21_600 and 30 <= avg <= peak <= 240):
                raise ValueError("punto della curva non valido")
        return self


SetKind = Literal["normal", "warmup", "drop", "failure"]


class SetLogPut(Strict):
    kg: Optional[float] = Field(default=None, ge=0, le=1000)
    reps: Optional[int] = Field(default=None, ge=0, le=500)
    rir: Optional[int] = Field(default=None, ge=0, le=10)
    completed: bool = True
    kind: SetKind = "normal"  # il riscaldamento non conta in volume, record e obiettivi


class ProgramWeekPut(Strict):
    week: int = Field(ge=1, le=52)


# Domini facoltativi di un backup JSON, nell'ordine in cui sono stati aggiunti al formato (v3, v4, v5).
# Stato a blob e sedute ci sono sempre. Vedi `BackupRestore` e il contratto del ripristino in docs/API.md.
BACKUP_OPTIONAL_DOMAINS = ("meal_templates", "meal_logs", "reminders", "foods",
                           "sleep_logs", "exercise_notes", "grocery_spend", "health_days")


class BackupRestore(BaseModel):
    """Backup v1 (solo stato), v2 (stato + sedute), v3, v4 e v5 (più i domini facoltativi). Conta la presenza del
    campo, non l'etichetta del formato: un dominio assente (o `null`) NON viene toccato dal ripristino, uno
    presente, anche vuoto, viene sostituito. Le sedute sono validate qui sotto."""
    model_config = ConfigDict(extra="ignore")
    format: Literal["fitweek-backup-v1", "fitweek-backup-v2", "fitweek-backup-v3", "fitweek-backup-v4",
                    "fitweek-backup-v5"]
    data: AppState
    workout_sessions: list["BackupSession"] = Field(default_factory=list, max_length=10_000)
    # v3: assenti nei backup precedenti → None = non toccare le tabelle esistenti
    meal_templates: Optional[list["BackupMealTemplate"]] = Field(default=None, max_length=2000)
    meal_logs: Optional[list["BackupMealLog"]] = Field(default=None, max_length=50_000)
    reminders: Optional[list["BackupReminder"]] = Field(default=None, max_length=500)
    foods: Optional[list["BackupFood"]] = Field(default=None, max_length=5000)
    # v4
    sleep_logs: Optional[list["BackupSleep"]] = Field(default=None, max_length=20_000)
    exercise_notes: Optional[list["BackupExerciseNote"]] = Field(default=None, max_length=1000)
    grocery_spend: Optional[list["BackupGrocerySpend"]] = Field(default=None, max_length=2000)
    # v5
    health_days: Optional[list["BackupHealthDay"]] = Field(default=None, max_length=20_000)


class BackupSet(Strict):
    exercise_id: Id
    set_index: int = Field(ge=1, le=50)
    kg: Optional[float] = Field(default=None, ge=0, le=1000)
    reps: Optional[int] = Field(default=None, ge=0, le=500)
    rir: Optional[int] = Field(default=None, ge=0, le=10)
    completed: bool = True
    kind: SetKind = "normal"
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
    heart: Optional[WorkoutHeartPut] = None  # v5





# ---- API v1: pasti e promemoria (M4) -------------------------------------------------------
MealSlot = Literal["lunch", "snack", "pre_workout", "dinner", "other"]
NutritionSource = Literal["estimate", "label", "manual", "off"]  # off = Open Food Facts
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


FoodCategory = Literal["primo", "salsa", "secondo", "contorno", "piatto_unico", "frutta", "dessert", "pane", "altro"]


class MealItem(Strict):
    """Una voce del vassoio. kcal/protein_g sono PER PORZIONE; qty moltiplica (es. 2 pagnottine)."""
    name: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    category: FoodCategory = "altro"
    qty: float = Field(default=1, gt=0, le=20)
    kcal: Optional[float] = Field(default=None, ge=0, le=5000)
    protein_g: Optional[float] = Field(default=None, ge=0, le=500)
    nutrition_source: Optional[NutritionSource] = None
    food_id: Optional[Id] = None
    takeaway: bool = False  # "lo porto a casa" (es. il secondo della mensa per cena)


class FoodPut(Strict):
    category: FoodCategory
    name: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    kcal: Optional[float] = Field(default=None, ge=0, le=5000)
    protein_g: Optional[float] = Field(default=None, ge=0, le=500)
    nutrition_source: Optional[NutritionSource] = None
    note: Text(300) = ""


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
    items: list[MealItem] = Field(default_factory=list, max_length=30)


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


StageMinutes = Optional[Annotated[int, Field(ge=0, le=1440)]]


class SleepPut(Strict):
    bed_time: HHMM
    wake_time: HHMM
    source: Literal["manual", "health_connect"] = "manual"
    note: Text(300) = ""
    # minuti per fase, solo dall'orologio (Health Connect); null = fase non registrata
    deep_min: StageMinutes = None
    light_min: StageMinutes = None
    rem_min: StageMinutes = None
    awake_min: StageMinutes = None


class HealthDayPut(Strict):
    """Valori del giorno letti dall'orologio; null = l'orologio non li ha registrati."""
    steps: Optional[int] = Field(default=None, ge=0, le=200_000)
    resting_hr: Optional[int] = Field(default=None, ge=25, le=220)
    hrv_ms: Optional[int] = Field(default=None, ge=1, le=500)  # variabilità del battito (RMSSD), media del giorno
    spo2: Optional[int] = Field(default=None, ge=50, le=100)  # ossigeno nel sangue in %, media del giorno


class ExerciseNotePut(Strict):
    note: Text(500)


class GrocerySpendPut(Strict):
    amount: float = Field(ge=0, le=10_000)
    note: Text(200) = ""


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


class BackupFood(_Stamps, FoodPut):
    model_config = ConfigDict(extra="ignore")
    id: Id
    note: Optional[Text(300)] = ""
    use_count: int = Field(default=0, ge=0)


class BackupReminder(_Stamps, ReminderPut):
    model_config = ConfigDict(extra="ignore")
    id: Id


class BackupSleep(_Stamps, SleepPut):
    model_config = ConfigDict(extra="ignore")
    date: IsoDate


class BackupExerciseNote(_Stamps, ExerciseNotePut):
    model_config = ConfigDict(extra="ignore")
    exercise_id: Id


class BackupGrocerySpend(_Stamps, GrocerySpendPut):
    model_config = ConfigDict(extra="ignore")
    week_start: IsoDate


class BackupHealthDay(_Stamps, HealthDayPut):
    model_config = ConfigDict(extra="ignore")
    date: IsoDate


BackupRestore.model_rebuild()
