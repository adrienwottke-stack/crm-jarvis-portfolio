import test from "node:test";
import assert from "node:assert/strict";
import {
  berechne,
  berechneReihe,
  pruefeRechnerWerte,
  standardWerte,
  zielJahr,
} from "../lib/zinsrechner.ts";
import { sucheImWegweiser } from "../lib/wegweiser.ts";

test("reference example matches the original calculator and annuity-due formula", () => {
  const result = berechne(standardWerte()).main;
  const q = Math.pow(1.07, 1 / 12);
  const formula = 5000 * 1.07 ** 30 + (300 * q * (q ** 360 - 1)) / (q - 1);
  assert.ok(Math.abs(result.end - formula) < 1e-6);
  assert.equal(Math.round(result.end), 390881);
  assert.equal(result.paid, 113000);
  assert.equal(result.points.length, 31);
});
test("zero interest, zero deposits and lump sum only retain the right principal", () => {
  assert.equal(berechneReihe(5000, 300, 30, 0).end, 113000);
  assert.equal(berechneReihe(0, 0, 50, 20).end, 0);
  assert.ok(
    Math.abs(berechneReihe(10000, 0, 10, 7).end - 10000 * 1.07 ** 10) < 1e-7,
  );
  assert.equal(berechneReihe(10000, 0, 10, 7).crossoverMonth, null);
});
test("negative returns reduce value without corrupting contributions or goal crossings", () => {
  const result = berechneReihe(10000, 0, 10, -10);
  assert.ok(Math.abs(result.end - 10000 * 0.9 ** 10) < 1e-6);
  assert.ok(result.gain < 0);
  assert.equal(result.paid, 10000);
  assert.equal(zielJahr(result.points, 9000), 0);
  assert.equal(zielJahr(result.points, 11000), null);
});
test("delay uses the same endpoint, starts principal and deposits together and handles short horizons", () => {
  const late = berechneReihe(5000, 300, 30, 7, 5);
  assert.equal(late.points[5].total, 0);
  assert.equal(late.paid, 5000 + 300 * 25 * 12);
  assert.ok(Math.abs(late.end - berechneReihe(5000, 300, 25, 7).end) < 1e-7);
  assert.equal(berechneReihe(5000, 300, 3, 7, 5).end, 0);
  assert.equal(berechneReihe(5000, 300, 5, 7, 5).paid, 0);
});
test("goal year is the first annual checkpoint, including already achieved and unreachable", () => {
  const result = berechneReihe(5000, 100, 10, 0);
  assert.equal(zielJahr(result.points, 5000), 0);
  assert.equal(zielJahr(result.points, 6200), 1);
  assert.equal(zielJahr(result.points, 100000), null);
});
test("server validation rejects non-finite, fractional durations, excessive values and unknown presets", () => {
  for (const patch of [
    { start: NaN },
    { monthly: Infinity },
    { years: 2.5 },
    { years: 51 },
    { monthly: 2001 },
    { start: -1 },
    { customRate: -21 },
    { customRate: 21 },
    { scenario: "__proto__" },
    { schemaVersion: 2 },
    { waitYears: 2 },
    { customerName: "x".repeat(81) },
    { goals: Array(9).fill({ id: "a", name: "a", amount: 1 }) },
  ])
    assert.throws(() => pruefeRechnerWerte({ ...standardWerte(), ...patch }));
  assert.deepEqual(pruefeRechnerWerte(standardWerte()), standardWerte());
  assert.equal(
    pruefeRechnerWerte({ ...standardWerte(), customRate: -20 }).customRate,
    -20,
  );
});
test("goals are bounded, uniquely identified and require names", () => {
  for (const goals of [
    [{ id: "a", name: "", amount: 5 }],
    [{ id: "a", name: "a", amount: -1 }],
    [
      { id: "a", name: "a", amount: 1 },
      { id: "a", name: "b", amount: 2 },
    ],
  ])
    assert.throws(() => pruefeRechnerWerte({ ...standardWerte(), goals }));
});
test("calculator is discoverable through the user's words", () => {
  for (const q of [
    "Zinsrechner",
    "Zinseszins",
    "Sparplan",
    "Investment",
    "Rendite",
  ])
    assert.ok(sucheImWegweiser(q).some((f) => f.id === "zinsrechner"));
});
