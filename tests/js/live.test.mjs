import test from "node:test";
import assert from "node:assert/strict";
import { parseBlock } from "../../static/js/live.js";

test("avviso: il dominio cambiato da un altro dispositivo; i propri e i commenti no", () => {
  assert.equal(parseBlock('event: change\ndata: {"domain": "sleep", "by": "altro"}', "io"), "sleep");
  assert.equal(parseBlock('event: change\ndata: {"domain": "sleep", "by": null}', "io"), "sleep");
  assert.equal(parseBlock('event: change\ndata: {"domain": "sleep", "by": "io"}', "io"), null);
  assert.equal(parseBlock(": ping", "io"), null);
  assert.equal(parseBlock("data: non json", "io"), null);
});
