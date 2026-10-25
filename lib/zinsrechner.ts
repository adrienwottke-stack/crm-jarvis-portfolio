// Effective annual return, monthly contributions at the BEGINNING of each
// month, as in ERGO TOOLS/zinsrechner. All calculations retain full precision.
export const RECHNER_VERSION = 1;
export const RENDITEN = [
  { id: "msci", name: "MSCI World", rate: 7, hint: "Weltweite Aktien" },
  { id: "sp500", name: "S&P 500", rate: 9, hint: "US-Aktien" },
  { id: "fest", name: "Festverzinslich", rate: 3, hint: "Beispielannahme" },
  { id: "tages", name: "Tagesgeld", rate: 1.5, hint: "Vergleichsannahme" },
  { id: "custom", name: "Eigene Annahme", rate: 5, hint: "Frei einstellbar" },
] as const;
export type RenditeId = (typeof RENDITEN)[number]["id"];
export type RechnerZiel = { id: string; name: string; amount: number };
export type RechnerWerte = {
  schemaVersion: 1;
  start: number;
  monthly: number;
  years: number;
  scenario: RenditeId;
  customRate: number;
  waitYears: number;
  goals: RechnerZiel[];
  customerName: string;
};
export type GespeichertesSzenario = {
  id: string;
  version: number;
  title: string;
  contactId: string | null;
  contactName: string | null;
  values: RechnerWerte;
  updatedAt: string;
};
export type RechnerKontakt = { id: string; name: string };
export type RechnerBerater = {
  name: string;
  phone: string | null;
  email: string | null;
};
export const ZIEL_VORSCHLAEGE: RechnerZiel[] = [
  { id: "welt", name: "Weltreise", amount: 30000 },
  { id: "camper", name: "Camper", amount: 60000 },
  { id: "porsche", name: "Porsche 911", amount: 130000 },
  { id: "wohnung", name: "Eigentumswohnung", amount: 250000 },
];
export function standardWerte(): RechnerWerte {
  return {
    schemaVersion: 1,
    start: 5000,
    monthly: 300,
    years: 30,
    scenario: "msci",
    customRate: 5,
    waitYears: 0,
    goals: [],
    customerName: "",
  };
}
export function rendite(w: RechnerWerte): number {
  return w.scenario === "custom"
    ? w.customRate
    : RENDITEN.find((s) => s.id === w.scenario)!.rate;
}
export const euro = (value: number) =>
  new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
export const prozent = (value: number) =>
  `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(value)} %`;
export const achsenEuro = (value: number) =>
  value >= 1e6
    ? `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(value / 1e6)} Mio. €`
    : value >= 1000
      ? `${Math.round(value / 1000)} Tsd. €`
      : euro(value);
export const MODELL_HINWEIS =
  "Modellrechnung mit konstanter, angenommener Rendite. Einzahlungen zu Monatsbeginn. Vor Steuern, Kosten und Inflation. Kapitalanlagen können an Wert verlieren; die dargestellten Beträge sind nicht garantiert.";

export class RechnerFehler extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "RechnerFehler";
    this.status = status;
  }
}
function objekt(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RechnerFehler("Die Berechnung ist unvollständig.");
  return value as Record<string, unknown>;
}
function zahl(
  value: unknown,
  min: number,
  max: number,
  title: string,
  integer = false,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    throw new RechnerFehler(
      `${title}: Bitte einen Wert zwischen ${min} und ${max} eingeben.`,
    );
  return value;
}
export function kurzerText(value: unknown, max: number, title: string): string {
  if (typeof value !== "string" || value.trim().length > max)
    throw new RechnerFehler(
      `${title}: Bitte höchstens ${max} Zeichen verwenden.`,
    );
  return value.trim();
}
export function pruefeRechnerWerte(raw: unknown): RechnerWerte {
  const w = objekt(raw);
  if (w.schemaVersion !== RECHNER_VERSION)
    throw new RechnerFehler(
      "Diese Berechnung verwendet eine unbekannte Version.",
    );
  if (!RENDITEN.some((s) => s.id === w.scenario))
    throw new RechnerFehler("Bitte eine Renditeannahme auswählen.");
  if (!Array.isArray(w.goals) || w.goals.length > 8)
    throw new RechnerFehler("Bitte höchstens acht Wunschziele verwenden.");
  const goals = w.goals.map((rawGoal) => {
    const g = objekt(rawGoal);
    const id = kurzerText(g.id, 80, "Ziel"),
      name = kurzerText(g.name, 50, "Zielname");
    if (!id || !name) throw new RechnerFehler("Bitte das Wunschziel benennen.");
    return { id, name, amount: zahl(g.amount, 1, 100000000, "Zielbetrag") };
  });
  if (new Set(goals.map((g) => g.id)).size !== goals.length)
    throw new RechnerFehler("Ein Wunschziel ist doppelt vorhanden.");
  const waitYears = zahl(w.waitYears, 0, 10, "Späterer Start", true);
  if (![0, 3, 5, 10].includes(waitYears))
    throw new RechnerFehler(
      "Bitte 3, 5 oder 10 Jahre als späteren Start wählen.",
    );
  return {
    schemaVersion: 1,
    start: zahl(w.start, 0, 100000, "Startkapital"),
    monthly: zahl(w.monthly, 0, 2000, "Sparrate"),
    years: zahl(w.years, 1, 50, "Laufzeit", true),
    scenario: w.scenario as RenditeId,
    customRate: zahl(w.customRate, -20, 20, "Rendite"),
    waitYears,
    goals,
    customerName: kurzerText(w.customerName, 80, "Name"),
  };
}
export type JahresPunkt = { year: number; total: number; paid: number };
export function berechneReihe(
  start: number,
  monthly: number,
  years: number,
  rate: number,
  delay = 0,
) {
  const monthlyRate = Math.pow(1 + rate / 100, 1 / 12) - 1;
  let total = delay === 0 ? start : 0,
    paid = total;
  const points: JahresPunkt[] = [{ year: 0, total, paid }];
  let crossoverMonth: number | null = null;
  for (let month = 1; month <= years * 12; month++) {
    if (delay > 0 && month === delay * 12 + 1) {
      total += start;
      paid += start;
    }
    if (month > delay * 12) {
      total += monthly;
      paid += monthly;
      const gain = total * monthlyRate;
      total += gain;
      if (monthly > 0 && gain >= monthly && crossoverMonth === null)
        crossoverMonth = month;
    }
    if (month % 12 === 0) points.push({ year: month / 12, total, paid });
  }
  return { points, end: total, paid, gain: total - paid, crossoverMonth };
}
export function berechne(w: RechnerWerte) {
  return {
    main: berechneReihe(w.start, w.monthly, w.years, rendite(w)),
    cash: berechneReihe(w.start, w.monthly, w.years, 1.5),
    delayed:
      w.waitYears > 0
        ? berechneReihe(w.start, w.monthly, w.years, rendite(w), w.waitYears)
        : null,
  };
}
export function zielJahr(points: JahresPunkt[], amount: number): number | null {
  return points.find((p) => p.total >= amount)?.year ?? null;
}

// MSCI World Net Returns, USD; complete calendar years only. Verified against
// the MSCI factsheet dated 31 August 2026. No mixture of net/gross or currencies.
export const HISTORIE_QUELLE =
  "https://www.msci.com/documents/10199/255599/msci-world-index-usd-net.pdf";
export const HISTORIE: readonly [number, number][] = [
  [2012, 15.83],
  [2013, 26.68],
  [2014, 4.94],
  [2015, -0.87],
  [2016, 7.51],
  [2017, 22.4],
  [2018, -8.71],
  [2019, 27.67],
  [2020, 15.9],
  [2021, 21.82],
  [2022, -18.14],
  [2023, 23.79],
  [2024, 18.67],
  [2025, 21.09],
];
