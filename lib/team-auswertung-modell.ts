import { dayToUtcDate, mondayOf, shiftDay } from "@/lib/dates";

export type Berichtszeit = "woche" | "monat" | "quartal" | "jahr";
export type Berichtsumfang = "direkte" | "struktur" | "teilteam";
export type Berichtszeitraum = { art: Berichtszeit; von: string; bis: string; label: string };

const kurz = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", timeZone: "UTC" });
const monat = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric", timeZone: "UTC" });

export function gueltigerBerichtstag(tag: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tag)) return false;
  const datum = dayToUtcDate(tag);
  return Number.isFinite(datum.getTime()) && datum.toISOString().slice(0, 10) === tag;
}

/** Der Aufrufer liefert den Berliner Kalendertag, keine Server-Lokalzeit. */
export function auswertungszeitraum(art: string | undefined, tag: string): Berichtszeitraum {
  if (!gueltigerBerichtstag(tag)) throw new RangeError("Ungültiger Berichtstag.");
  const datum = dayToUtcDate(tag);
  const jahr = datum.getUTCFullYear();
  const m = datum.getUTCMonth();
  if (art === "woche") {
    const von = mondayOf(tag);
    const bis = shiftDay(von, 6);
    return { art, von, bis, label: `${kurz.format(dayToUtcDate(von))} – ${kurz.format(dayToUtcDate(bis))} ${dayToUtcDate(bis).getUTCFullYear()}` };
  }
  const auswahl = art === "jahr" || art === "quartal" ? art : "monat";
  const startMonat = auswahl === "jahr" ? 0 : auswahl === "quartal" ? Math.floor(m / 3) * 3 : m;
  const monate = auswahl === "jahr" ? 12 : auswahl === "quartal" ? 3 : 1;
  const start = new Date(Date.UTC(jahr, startMonat, 1));
  const ende = new Date(Date.UTC(jahr, startMonat + monate, 0));
  return {
    art: auswahl,
    von: start.toISOString().slice(0, 10),
    bis: ende.toISOString().slice(0, 10),
    label: auswahl === "jahr" ? String(jahr) : auswahl === "quartal" ? `${Math.floor(m / 3) + 1}. Quartal ${jahr}` : monat.format(start),
  };
}

export type Berichtskonto = { id: string; path: string; leaderId: string | null };
export type AusgewaehlterUmfang = { art: Berichtsumfang; wurzelId: string; teamIds: string[] };

/**
 * Nur Konten aus der bereits serverseitig autorisierten Struktur übergeben.
 * Eine fremde Teilteam-ID wird verworfen, niemals mit neuen Daten nachgeladen.
 */
export function auswertungsUmfang(
  betrachterId: string,
  erlaubteKonten: Berichtskonto[],
  art: string | undefined,
  teilteamId?: string,
): AusgewaehlterUmfang {
  const konten = [...new Map(erlaubteKonten.map((konto) => [konto.id, konto])).values()];
  const auswahl: Berichtsumfang = art === "direkte" || art === "teilteam" ? art : "struktur";
  const wurzelId = auswahl === "teilteam" ? teilteamId : betrachterId;
  const wurzel = konten.find((konto) => konto.id === wurzelId);
  if (!wurzel) throw new RangeError("Dieses Teilteam ist nicht verfügbar.");
  const teamIds = konten.filter((konto) => {
    if (konto.id === wurzel.id) return false;
    if (auswahl === "direkte") return konto.leaderId === wurzel.id;
    // Ein noch nicht zugeordneter Wurzelpfad '/' darf nie alle Konten öffnen.
    return wurzel.path !== "/" && konto.path.startsWith(wurzel.path);
  }).map((konto) => konto.id);
  return { art: auswahl, wurzelId: wurzel.id, teamIds };
}

export type EinheitenTag = { tag: string; hundertstel: number };
export type Kurvenpunkt = { tag: string; tageswert: number; kumuliert: number };

/** Keine Startbestände: Die Kurve beschreibt ausschließlich datierte Buchungen. */
export function einheitenVerlauf(zeit: Berichtszeitraum, buchungen: EinheitenTag[]): Kurvenpunkt[] {
  const tage = new Map<string, number>();
  for (const buchung of buchungen) {
    if (buchung.tag < zeit.von || buchung.tag > zeit.bis) continue;
    tage.set(buchung.tag, (tage.get(buchung.tag) ?? 0) + buchung.hundertstel);
  }
  const punkte: Kurvenpunkt[] = [];
  let kumuliert = 0;
  for (let tag = zeit.von; tag <= zeit.bis; tag = shiftDay(tag, 1)) {
    const tageswert = tage.get(tag) ?? 0;
    kumuliert += tageswert;
    punkte.push({ tag, tageswert, kumuliert });
  }
  return punkte;
}

export const BERICHTSAKTIVITAETEN = ["CALL", "APPOINTMENT_SET", "APPOINTMENT_HELD", "DEAL_WON"] as const;
export type Berichtsaktivitaet = (typeof BERICHTSAKTIVITAETEN)[number];
export type Aktivitaetszahlen = Record<Berichtsaktivitaet, number>;

export function aktivitaetssummen(zeilen: { type: string; count: number }[]): Aktivitaetszahlen {
  const zahlen: Aktivitaetszahlen = { CALL: 0, APPOINTMENT_SET: 0, APPOINTMENT_HELD: 0, DEAL_WON: 0 };
  for (const zeile of zeilen) {
    if (BERICHTSAKTIVITAETEN.includes(zeile.type as Berichtsaktivitaet)) {
      zahlen[zeile.type as Berichtsaktivitaet] += zeile.count;
    }
  }
  return zahlen;
}

export type Berichtsgruppe = {
  konten: number;
  aktivitaetsKonten: number;
  aktivitaeten: Aktivitaetszahlen | null;
  einheitenZeitraum: number;
  einheitenGesamt: number;
  startbestand: number;
  kurve: Kurvenpunkt[];
};

export function berichtsgruppe({ zeit, konten, buchungen, gebuchtGesamt, aktivitaeten }: {
  zeit: Berichtszeitraum;
  konten: { id: string; einheitenStart: number; hatAktivitaetsprofil: boolean }[];
  buchungen: (EinheitenTag & { userId: string })[];
  gebuchtGesamt: { userId: string; hundertstel: number }[];
  aktivitaeten: { userId: string; type: string; count: number }[];
}): Berichtsgruppe {
  const eindeutig = [...new Map(konten.map((konto) => [konto.id, konto])).values()];
  const ids = new Set(eindeutig.map((konto) => konto.id));
  const aktivitaetsIds = new Set(eindeutig.filter((konto) => konto.hatAktivitaetsprofil).map((konto) => konto.id));
  const startbestand = eindeutig.reduce((summe, konto) => summe + konto.einheitenStart, 0);
  const kurve = einheitenVerlauf(zeit, buchungen.filter((buchung) => ids.has(buchung.userId)));
  return {
    konten: ids.size,
    aktivitaetsKonten: aktivitaetsIds.size,
    aktivitaeten: aktivitaetsIds.size > 0 ? aktivitaetssummen(aktivitaeten.filter((zeile) => aktivitaetsIds.has(zeile.userId))) : null,
    einheitenZeitraum: kurve.at(-1)?.kumuliert ?? 0,
    einheitenGesamt: startbestand + gebuchtGesamt.filter((zeile) => ids.has(zeile.userId)).reduce((summe, zeile) => summe + zeile.hundertstel, 0),
    startbestand,
    kurve,
  };
}
