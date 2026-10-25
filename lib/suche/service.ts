import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { beraterIds, type Betrachter } from "@/lib/scope";
import { featureStates } from "@/lib/features";
import { WEGWEISER, type WegweiserEintrag } from "@/lib/wegweiser";
import { funktionstreffer } from "./funktionen";
import { vereinbarungSichtbar, vereinbarungStatusTexte } from "@/lib/vereinbarungen-regeln";
import { berlinLocalToUtc, berlinToday, berlinDayOf } from "@/lib/dates";
import { alleWoerter, normalerText, telefonText } from "./sql";
import {
  erkenneSuchabsicht, gueltigeLetzte, istTelefonSuche, passenAlle, suchtext, telefonZiffern,
  textAusschnitt, type Suchantwort, type Suchtreffer, type Suchtyp, type TrefferTyp,
} from "./modell";

export async function suchfunktionen(user: Betrachter): Promise<WegweiserEintrag[]> {
  const flags = await featureStates();
  const aktiv = (key: string) => !flags.has(key) || flags.get(key) === "TEST" || flags.get(key) === "LAEUFT";
  if (!aktiv("wegweiser")) return [];
  return WEGWEISER.filter(e => (!e.nurAdmin || user.role === "ADMIN") && (!e.merkmal || aktiv(e.merkmal)));
}

type Zeile = {
  id: string; typ: TrefferTyp; titel: string; kontext: string; inhalt: string; telefon: string | null;
  href: string; zeit: Date | null; ende: Date | null; offen: boolean; punkte: number;
  extra: Record<string, string | null>;
};

const datum = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Berlin" });
const uhr = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
const phasen: Record<string, string> = { NEU: "Neu", KONTAKTIERT: "Kontaktiert", TERMIN_VEREINBART: "Termin vereinbart", TERMIN_GEHALTEN: "Termin gehalten", ABSCHLUSS: "Abschluss" };
const schritte: Record<string, string> = { ANRUF: "Zurückrufen", TERMIN: "Termin", NACHFASSEN: "Nachfassen", EMPFEHLUNG_ERFRAGEN: "Empfehlungen erfragen", SONSTIGES: "Nächster Schritt" };

function zurAnzeige(zeile: Zeile, woerter: string[]): Suchtreffer {
  let kontext = zeile.kontext;
  if (zeile.typ === "kontakte") {
    const phase = zeile.extra.outcome === "VERLOREN" ? "Beendet" : zeile.extra.outcome === "GEWONNEN" ? "Abschluss" : phasen[zeile.extra.stage ?? ""] ?? "Kontakt";
    kontext = [phase, zeile.zeit && `${schritte[zeile.extra.nextStepType ?? ""] ?? "Nächster Schritt"} · ${datum.format(zeile.zeit)}`].filter(Boolean).join(" · ");
  } else if (zeile.typ === "absprachen") {
    kontext = `${zeile.kontext} · ${vereinbarungStatusTexte[zeile.extra.status as keyof typeof vereinbarungStatusTexte] ?? "Absprache"}`;
  }
  if (zeile.typ !== "kontakte" && zeile.zeit) kontext += ` · ${datum.format(zeile.zeit)}${zeile.typ === "termine" && zeile.extra.ganztags !== "true" ? `, ${uhr.format(zeile.zeit)}` : ""}`;
  let hinweis: string | undefined;
  if (woerter.length && !passenAlle(woerter, zeile.titel)) {
    const fehlend = woerter.filter(w => !passenAlle([w], zeile.titel));
    const felder = [["E-Mail", zeile.extra.email], ["Telefon", zeile.telefon], ["Beruf", zeile.extra.job], ["Herkunft", zeile.extra.source], ["Notiz", zeile.extra.note], ["Nächster Schritt", zeile.extra.nextStepNote], ["Verlauf", zeile.extra.history]];
    const passend = felder.find(([, wert]) => wert && fehlend.some(w => passenAlle([w], wert)));
    if (passend?.[1]) hinweis = `${passend[0]}: ${textAusschnitt(passend[1], fehlend)}`;
    else if (zeile.inhalt && fehlend.some(w => passenAlle([w], zeile.inhalt))) hinweis = textAusschnitt(zeile.inhalt, fehlend);
  }
  if (!hinweis && zeile.typ === "kontakte" && zeile.telefon) hinweis = zeile.telefon;
  let href = zeile.href;
  if (zeile.typ === "termine" && zeile.zeit && zeile.extra.kalenderId) {
    href = `/kalender?ansicht=liste&tag=${berlinDayOf(zeile.zeit)}#termin-${encodeURIComponent(zeile.extra.kalenderId)}`;
  }
  return { id: zeile.id, typ: zeile.typ, titel: zeile.titel, kontext, href, hinweis, punkte: Number(zeile.punkte) };
}

/** Nur beteiligte Konten und die aktuelle Führungskette; dieselbe Fachregel wie die Detailseite. */
async function abspracheIds(userId: string): Promise<string[]> {
  const konto = { id: true, path: true, passwordHash: true, deactivatedAt: true } as const;
  const kandidaten = await prisma.partnerVereinbarung.findMany({
    where: { OR: [{ initiatorId: userId }, { empfaengerId: userId }] },
    select: { id: true, initiator: { select: konto }, empfaenger: { select: konto } },
  });
  return kandidaten.filter(v => vereinbarungSichtbar(userId, v.initiator, v.empfaenger)).map(v => v.id);
}

/** Besitzer-/Strukturfilter stehen innerhalb jeder Quelle, vor Bewertung und Begrenzung. */
function datenquellen(user: Betrachter, teamIds: string[], vereinbarungen: string[]) {
  const id = user.id;
  return Prisma.sql`
    SELECT 'kontakte:' || c.id AS id, 'kontakte'::text AS typ, c.name AS titel, ''::text AS kontext,
      concat_ws(' ', c.email, c.job, c.source, c.note, c."nextStepNote") AS inhalt, c.phone AS telefon,
      '/contacts/' || c.id AS href, c."nextStepAt" AS zeit, NULL::timestamp AS ende,
      c.outcome = 'OFFEN' AS offen,
      jsonb_build_object('email', c.email, 'job', c.job, 'source', c.source, 'note', c.note, 'nextStepNote', c."nextStepNote", 'nextStepType', c."nextStepType", 'stage', c.stage, 'outcome', c.outcome) AS extra
    FROM "Contact" c WHERE c."ownerId" = ${id}
    UNION ALL
    SELECT 'kontakte:' || c.id, 'kontakte', c.name, '',
      concat_ws(' ', c.email, c.job, c.source, c.note, c."nextStepNote", a.text), c.phone,
      '/contacts/' || c.id, c."nextStepAt", NULL::timestamp, c.outcome = 'OFFEN',
      jsonb_build_object('email', c.email, 'job', c.job, 'source', c.source, 'note', c.note, 'nextStepNote', c."nextStepNote", 'nextStepType', c."nextStepType", 'stage', c.stage, 'outcome', c.outcome, 'history', a.text)
    FROM "Contact" c JOIN "Activity" a ON a."contactId" = c.id WHERE c."ownerId" = ${id}
    UNION ALL
    SELECT 'termine:kontakt:' || c.id, 'termine', c.name, 'Kundentermin', coalesce(c."nextStepNote", ''), c.phone,
      '/contacts/' || c.id, c."appointmentAt", c."appointmentAt" + interval '1 hour', TRUE,
      jsonb_build_object('nextStepNote', c."nextStepNote")
    FROM "Contact" c WHERE c."ownerId" = ${id} AND c."appointmentAt" IS NOT NULL AND c.outcome <> 'VERLOREN'
    UNION ALL
    SELECT 'termine:eigen:' || t.id, 'termine', coalesce(nullif(trim(t.titel), ''), 'Belegt'), 'Kalender', concat_ws(' ', t.ort, t.notiz), NULL,
      '/kalender', t.von, t.bis, TRUE, jsonb_build_object('note', t.notiz, 'kalenderId', 'eigen:' || t.id, 'ganztags', t.ganztags::text)
    FROM "Termin" t WHERE t."ownerId" = ${id}
    UNION ALL
    SELECT 'termine:fremd:' || t.id, 'termine', t.titel, q.name, coalesce(t.ort, ''), NULL,
      '/kalender', t.von, t.bis, TRUE, jsonb_build_object('kalenderId', 'fremd:' || t.id, 'ganztags', t.ganztags::text)
    FROM "Fremdtermin" t JOIN "Kalenderquelle" q ON q.id = t."quelleId" WHERE q."ownerId" = ${id} AND q.aktiv = TRUE
    UNION ALL
    SELECT 'team:' || u.id, 'team', u.name, CASE WHEN u."leaderId" = ${id} THEN 'Direkter Partner' ELSE 'Partner im Team' END, ''::text, NULL,
      '/mannschaft/' || u.id, NULL::timestamp, NULL::timestamp, TRUE, '{}'::jsonb
    FROM "User" u WHERE u.id IN (${Prisma.join(teamIds.length ? teamIds : [id])}) AND u.id <> ${id} AND u."deactivatedAt" IS NULL
    UNION ALL
    SELECT 'ziele:' || z.id, 'ziele', z.titel, CASE WHEN z.zeitraum = 'WOCHE' THEN 'Wochenziel' WHEN z.zeitraum = 'MONAT' THEN 'Monatsziel' ELSE 'Persönliches Ziel' END,
      coalesce(z.wunsch, ''), NULL, '/fortschritt/' || z.id, z.start, z.ende, z."archiviertAt" IS NULL, '{}'::jsonb
    FROM "Ziel" z WHERE z."inhaberId" = ${id}
    UNION ALL
    SELECT 'absprachen:' || v.id, 'absprachen', v.titel,
      'Mit ' || CASE WHEN v."initiatorId" = ${id} THEN b.name ELSE a.name END,
      CASE WHEN v."initiatorId" = ${id} THEN b.name ELSE a.name END, NULL,
      '/mannschaft/vereinbarungen/' || v.id, v."faelligAm", v."endetAm", v.status IN ('VORGESCHLAGEN', 'BESTAETIGT'),
      jsonb_build_object('status', v.status, 'art', v.art)
    FROM "PartnerVereinbarung" v JOIN "User" a ON a.id = v."initiatorId" JOIN "User" b ON b.id = v."empfaengerId"
    WHERE v.id IN (${Prisma.join(vereinbarungen.length ? vereinbarungen : [""])})
    UNION ALL
    SELECT 'termine:absprache:' || v.id, 'termine', v.titel,
      'Mit ' || CASE WHEN v."initiatorId" = ${id} THEN b.name ELSE a.name END,
      CASE WHEN v."initiatorId" = ${id} THEN b.name ELSE a.name END, NULL,
      '/mannschaft/vereinbarungen/' || v.id, v."faelligAm", v."endetAm", TRUE, '{}'::jsonb
    FROM "PartnerVereinbarung" v JOIN "User" a ON a.id = v."initiatorId" JOIN "User" b ON b.id = v."empfaengerId"
    WHERE v.id IN (${Prisma.join(vereinbarungen.length ? vereinbarungen : [""])}) AND v.art = 'TERMIN' AND v.status = 'BESTAETIGT'
  `;
}

export async function suche(user: Betrachter, eingabe: {
  q: string; typ?: Suchtyp; seite?: number; zuletzt?: string[];
}, katalog?: WegweiserEintrag[]): Promise<Suchantwort> {
  const q = eingabe.q.trim().slice(0, 100);
  const typ = eingabe.typ ?? "alle";
  const absicht = erkenneSuchabsicht(q, typ);
  const funktionen = katalog ?? await suchfunktionen(user);
  const letzte = gueltigeLetzte(eingabe.zuletzt);
  const seitengroesse = 20;
  const seite = Math.max(0, Math.min(499, Math.floor(eingabe.seite || 0)));
  if (!q && !letzte.length) return { treffer: [], mehr: false, filter: [] };
  if (q && !suchtext(q)) return { treffer: [], mehr: false, filter: [] };
  const funk = (typ === "alle" || typ === "funktionen") ? (q ? funktionstreffer(funktionen, q) : funktionen.filter(f => letzte.includes(`funktionen:${f.id}`)).map(f => ({ id: `funktionen:${f.id}`, typ: "funktionen" as const, titel: f.titel, kontext: f.bereich, href: f.href, punkte: 0 }))) : [];
  if (typ === "funktionen" || (q && suchtext(q).length < 2)) return { treffer: funk.slice(seite * seitengroesse, (seite + 1) * seitengroesse), mehr: funk.length > (seite + 1) * seitengroesse, filter: [] };

  const [team, absprachen] = await Promise.all([
    beraterIds(user, user.role === "ADMIN" ? "ALLE" : "STRUKTUR"), abspracheIds(user.id),
  ]);
  const titel = Prisma.sql`ntitel`;
  const alles = Prisma.sql`concat_ws(' ', ntitel, ninhalt)`;
  const woerter = absicht.woerter;
  const nummer = istTelefonSuche(q) ? telefonZiffern(q) : null;
  const bedingungen: Prisma.Sql[] = [];
  if (!q) bedingungen.push(Prisma.sql`id IN (${Prisma.join(letzte)})`);
  else if (nummer) bedingungen.push(Prisma.sql`position(${nummer} in ntelefon) > 0`);
  else if (woerter.length) bedingungen.push(alleWoerter(alles, woerter));
  if (absicht.typ !== "alle" && absicht.typ !== "funktionen") bedingungen.push(Prisma.sql`typ = ${absicht.typ}`);
  if (absicht.ohneNummer) bedingungen.push(Prisma.sql`typ = 'kontakte' AND ntelefon = ''`);
  if (absicht.rueckrufe) bedingungen.push(Prisma.sql`typ = 'kontakte' AND extra->>'nextStepType' = 'ANRUF' AND offen`);
  if (absicht.ueberfaellig) bedingungen.push(Prisma.sql`typ IN ('kontakte', 'absprachen') AND offen AND zeit < ${berlinLocalToUtc(`${berlinToday()}T00:00`)}`);
  if (absicht.von && absicht.bis) {
    const start = berlinLocalToUtc(`${absicht.von}T00:00`);
    bedingungen.push(Prisma.sql`zeit < ${berlinLocalToUtc(`${absicht.bis}T00:00`)} AND ((ende IS NOT NULL AND ende > ${start}) OR (ende IS NULL AND zeit >= ${start}))`);
  }
  const punkte = !q ? Prisma.sql`0` : nummer ? Prisma.sql`CASE WHEN ntelefon = ${nummer} THEN 1250 ELSE 1080 END`
    : !woerter.length ? Prisma.sql`900`
    : Prisma.sql`CASE WHEN ntitel = ${absicht.text} THEN 1250
      WHEN starts_with(ntitel, ${absicht.text}) THEN 1100
      WHEN ${alleWoerter(titel, woerter, false)} THEN 1050
      WHEN ${alleWoerter(alles, woerter, false)} THEN 820
      WHEN ${alleWoerter(titel, woerter)} THEN 780 ELSE 560 END`;

  // Bewertung vor LIMIT: auch bei großen Listen bleiben exakte Treffer erreichbar.
  const daten = await prisma.$queryRaw<Zeile[]>(Prisma.sql`
    WITH quellen AS (${datenquellen(user, team, absprachen)}), normalisiert AS (
      SELECT *, ${normalerText(Prisma.sql`titel`)} AS ntitel,
        ${normalerText(Prisma.sql`inhalt`)} AS ninhalt, ${telefonText(Prisma.sql`telefon`)} AS ntelefon FROM quellen
    ), bewertet AS (
      SELECT *, ${punkte} AS punkte FROM normalisiert
      WHERE ${bedingungen.length ? Prisma.join(bedingungen, " AND ") : Prisma.sql`TRUE`}
    ), eindeutig AS (
      SELECT DISTINCT ON (id) * FROM bewertet ORDER BY id, punkte DESC, length(inhalt), inhalt
    ) SELECT * FROM eindeutig
    ORDER BY punkte DESC, offen DESC, CASE WHEN zeit < ${berlinLocalToUtc(`${berlinToday()}T00:00`)} THEN 1 ELSE 0 END, zeit ASC NULLS LAST, titel, id
    LIMIT ${(seite + 1) * seitengroesse + 1}
  `);
  const treffer = [...funk, ...daten.map(z => zurAnzeige(z, woerter))];
  if (!q) {
    treffer.sort((a, b) => letzte.indexOf(a.id) - letzte.indexOf(b.id));
    return { treffer, mehr: false, filter: [] };
  }
  // Gleiche Entität bleibt stabil; Funktionen und Inhalte teilen eine Rangfolge.
  treffer.sort((a, b) => b.punkte - a.punkte || (a.typ === b.typ ? 0 : a.typ.localeCompare(b.typ)));
  return { treffer: treffer.slice(seite * seitengroesse, (seite + 1) * seitengroesse), mehr: treffer.length > (seite + 1) * seitengroesse, filter: absicht.filter };
}
