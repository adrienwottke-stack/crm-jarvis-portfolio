import { Prisma } from "@/lib/generated/prisma/client";
import { wortMuster } from "./modell";

/** SQL-Fragmente enthalten nur feste Spalten; alle Nutzereingaben sind Parameter. */
export function normalerText(feld: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`trim(regexp_replace(replace(replace(replace(
    regexp_replace(normalize(replace(replace(replace(replace(lower(coalesce(${feld}, '')), 'ß', 'ss'), 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), NFKD), '[̀-ͯ]', '', 'g'),
    'ae', 'a'), 'oe', 'o'), 'ue', 'u'), '[^[:alnum:]]+', ' ', 'g'))`;
}

export function alleWoerter(feld: Prisma.Sql, woerter: string[], unscharf = true): Prisma.Sql {
  return woerter.length ? Prisma.sql`(${Prisma.join(woerter.map(wort => Prisma.sql`${feld} ~ ${wortMuster(wort, unscharf)}`), " AND ")})` : Prisma.sql`TRUE`;
}

export function telefonText(feld: Prisma.Sql): Prisma.Sql {
  const ziffern = Prisma.sql`regexp_replace(coalesce(${feld}, ''), '[^0-9]', '', 'g')`;
  return Prisma.sql`CASE WHEN trim(coalesce(${feld}, '')) ~ '^([+]49|0049)' THEN '0' || regexp_replace(${ziffern}, '^(0049|49)0?', '') ELSE ${ziffern} END`;
}
