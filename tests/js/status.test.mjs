import test from "node:test";
import assert from "node:assert/strict";
import { pendingSummary } from "../../static/js/status.js";

test("operazioni in attesa raggruppate per tipo di dato", () => {
  assert.equal(pendingSummary(["/api/v1/workout-sessions/s/sets/a1/1", "/api/v1/meal-logs/m1", "/api/v1/workout-sessions/s/sets/a1/2", "/api/v1/boh"]), "2 allenamento · 1 pasti · 1 altro");
  assert.equal(pendingSummary([]), "");
});
