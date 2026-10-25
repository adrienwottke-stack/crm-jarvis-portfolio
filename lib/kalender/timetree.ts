// Zugriff auf TimeTree.
//
// ===========================================================================
// DAS HIER IST EIN INOFFIZIELLER WEG. Bitte vor jeder Aenderung lesen.
// ===========================================================================
//
// TimeTree hat seine oeffentliche Schnittstelle am 22.12.2023 abgeschaltet
// (timetreeapp.com/intl/newsroom/2023-12-14/connect-app-api-202312). Es gibt
// keinen Export, keinen ICS-Link, kein Abo. Was bleibt, sind die Aufrufe, die
// die Weboberflaeche von TimeTree selbst benutzt. Genau die stehen hier -
// nachgebaut nach TimeTree-Exporter (github.com/eoleedi/TimeTree-Exporter, MIT).
//
// Drei Dinge folgen daraus, und alle drei stehen auch auf der Quellen-Seite:
//
//   1. Es kann jederzeit brechen. TimeTree schuldet uns nichts. Deshalb faengt
//      der Abgleich JEDEN Fehler ab und schreibt ihn an die Quelle, statt ihn
//      nach oben zu werfen: ein kaputter TimeTree darf den Kalender nicht
//      mitnehmen. Die Quelle ist Beiwerk, nie Fundament.
//   2. Es geht nur mit E-Mail und Passwort. Wer sich bei TimeTree ueber Apple
//      oder Google anmeldet, hat keins - fuer den geht dieser Weg gar nicht.
//   3. Sparsam abfragen. Zu viele Aufrufe in kurzer Zeit fuehren zu Sperren
//      (Fehlercode -495). Diese Datei fragt deshalb nie von sich aus - die
//      Schranke sitzt in abgleich.ts (fruehestens alle 15 Minuten, und der
//      Cron laeuft die Quellen nacheinander statt gleichzeitig ab).

const BASIS = "https://timetreeapp.com/api/v1";
const KENNUNG = "web/2.1.0/en";

export class TimeTreeFehler extends Error {
  /** Ob ein erneuter Versuch ueberhaupt Sinn hat. */
  readonly dauerhaft: boolean;

  // Ausgeschriebenes Feld statt einer Parameter-Eigenschaft im Konstruktor:
  // node kann Letztere in seinem Strip-Modus nicht uebersetzen, und dann
  // liesse sich diese Datei mit scripts/ nicht mehr durchspielen.
  constructor(message: string, dauerhaft: boolean) {
    super(message);
    this.name = "TimeTreeFehler";
    this.dauerhaft = dauerhaft;
  }
}

function kopfzeilen(sitzung?: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-Timetreea": KENNUNG,
    ...(sitzung ? { Cookie: `_session_id=${sitzung}` } : {}),
  };
}

/** Fehlercodes, die TimeTree im Rumpf mitschickt, in Klartext uebersetzen. */
function fehlerText(code: unknown): TimeTreeFehler {
  if (code === -702) {
    return new TimeTreeFehler("E-Mail oder Passwort stimmt nicht.", true);
  }
  if (code === -495) {
    return new TimeTreeFehler(
      "TimeTree bremst uns gerade aus. Später noch einmal versuchen.",
      false
    );
  }
  return new TimeTreeFehler(
    "TimeTree hat die Anmeldung abgelehnt. Möglicherweise meldest du dich dort über Apple oder Google an — dann gibt es kein Passwort, und dieser Weg funktioniert nicht.",
    true
  );
}

/**
 * Anmelden. Liefert die Sitzungskennung aus dem Cookie `_session_id`.
 *
 * PUT und nicht POST - so macht es die Weboberflaeche.
 */
export async function anmelden(email: string, passwort: string): Promise<string> {
  // TimeTree erwartet eine Geraetekennung. Sie muss nicht stabil sein; eine
  // feste waere sogar auffaelliger als eine je Anmeldung neue.
  const uuid = crypto.randomUUID().replace(/-/g, "");

  let antwort: Response;
  try {
    antwort = await fetch(`${BASIS}/auth/email/signin`, {
      method: "PUT",
      headers: kopfzeilen(),
      body: JSON.stringify({ uid: email, password: passwort, uuid }),
      cache: "no-store",
    });
  } catch {
    throw new TimeTreeFehler("TimeTree war nicht erreichbar.", false);
  }

  if (!antwort.ok) {
    let code: unknown = null;
    try {
      code = ((await antwort.json()) as { code?: unknown }).code;
    } catch {
      // Kein JSON im Rumpf - dann bleibt es beim allgemeinen Text.
    }
    throw fehlerText(code);
  }

  // Node faltet mehrere Set-Cookie-Zeilen zu einer zusammen; deshalb wird hier
  // gesucht statt zerlegt.
  const cookies = antwort.headers.getSetCookie?.() ?? [];
  for (const cookie of cookies) {
    const treffer = /_session_id=([^;]+)/.exec(cookie);
    if (treffer) return treffer[1]!;
  }
  const roh = antwort.headers.get("set-cookie") ?? "";
  const treffer = /_session_id=([^;]+)/.exec(roh);
  if (treffer) return treffer[1]!;

  throw new TimeTreeFehler(
    "TimeTree hat keine Sitzung ausgegeben. Vermutlich hat sich die Anmeldung dort geändert.",
    false
  );
}

async function hole<T>(pfad: string, sitzung: string): Promise<T> {
  let antwort: Response;
  try {
    antwort = await fetch(`${BASIS}${pfad}`, {
      headers: kopfzeilen(sitzung),
      cache: "no-store",
    });
  } catch {
    throw new TimeTreeFehler("TimeTree war nicht erreichbar.", false);
  }
  if (antwort.status === 401 || antwort.status === 403) {
    throw new TimeTreeFehler("TimeTree hat die Sitzung abgelehnt.", true);
  }
  if (!antwort.ok) {
    throw new TimeTreeFehler(`TimeTree antwortete mit ${antwort.status}.`, false);
  }
  return (await antwort.json()) as T;
}

export type TimeTreeKalender = { id: string; name: string };

export async function kalenderListe(sitzung: string): Promise<TimeTreeKalender[]> {
  const daten = await hole<{ calendars?: { id?: unknown; name?: unknown }[] }>(
    "/calendars?since=0",
    sitzung
  );
  return (daten.calendars ?? [])
    .filter((kalender) => kalender.id != null)
    .map((kalender) => ({
      id: String(kalender.id),
      name: typeof kalender.name === "string" ? kalender.name : "Ohne Namen",
    }));
}

/** Ein Termin so, wie TimeTree ihn liefert - nur die Felder, die wir nutzen. */
export type TimeTreeTermin = {
  id: string;
  title: string;
  /** Millisekunden. */
  start_at: number;
  end_at: number;
  all_day: boolean;
  location: string | null;
  /** RRULE-/EXDATE-Zeilen einer Serie. */
  recurrences: string[];
  /** Geloescht - TimeTree schickt Entfernungen als Aenderung mit. */
  geloescht: boolean;
};

type RohTermin = Record<string, unknown>;

function zuTermin(roh: RohTermin): TimeTreeTermin | null {
  const id = roh.id;
  const start = roh.start_at;
  if (id == null || typeof start !== "number") return null;

  const ende = typeof roh.end_at === "number" ? roh.end_at : start + 60 * 60_000;
  const recurrences = Array.isArray(roh.recurrences)
    ? roh.recurrences.filter((zeile): zeile is string => typeof zeile === "string")
    : [];

  return {
    id: String(id),
    title: typeof roh.title === "string" && roh.title.trim() ? roh.title : "Termin",
    start_at: start,
    end_at: ende,
    all_day: roh.all_day === true,
    location: typeof roh.location === "string" && roh.location ? roh.location : null,
    recurrences,
    // TimeTree kennzeichnet Entfernungen ueber deleted_at bzw. type 4.
    geloescht: roh.deleted_at != null || roh.type === 4,
  };
}

/**
 * Termine eines Kalenders holen.
 *
 * `seit` ist die Marke des letzten Abgleichs: mit ihr kommt nur zurueck, was
 * sich seitdem geaendert hat. Beim ersten Lauf steht dort "0", und dann kommt
 * alles - deshalb blaettert die Schleife ueber `chunk`.
 *
 * Die Obergrenze ist ein Notausgang, keine fachliche Grenze: sollte TimeTree
 * `chunk` einmal nicht mehr zuruecksetzen, laeuft die Schleife sonst ewig.
 */
export async function termineHolen(
  sitzung: string,
  kalenderId: string,
  seit = "0"
): Promise<{ termine: TimeTreeTermin[]; seit: string }> {
  const termine: TimeTreeTermin[] = [];
  let marke = seit;

  for (let runde = 0; runde < 50; runde += 1) {
    const daten = await hole<{
      events?: RohTermin[];
      chunk?: boolean;
      since?: unknown;
    }>(
      `/calendar/${encodeURIComponent(kalenderId)}/events/sync?since=${encodeURIComponent(marke)}`,
      sitzung
    );

    for (const roh of daten.events ?? []) {
      const termin = zuTermin(roh);
      if (termin) termine.push(termin);
    }

    if (daten.since != null) marke = String(daten.since);
    if (daten.chunk !== true) break;
  }

  return { termine, seit: marke };
}
