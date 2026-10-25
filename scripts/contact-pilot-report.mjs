import { readFile } from "node:fs/promises";
import { evaluateContactPilot } from "../lib/experiments/contact-pilot.ts";

const file = process.argv[2];
if (!file) throw new Error("Aufruf: node --import ./scripts/alias-hook.mjs scripts/contact-pilot-report.mjs <Pilotdatei.json>");
const input = JSON.parse(await readFile(file, "utf8"));
const now = process.argv[3] ? new Date(process.argv[3]) : new Date();
console.log(JSON.stringify(evaluateContactPilot(input, now), null, 2));
