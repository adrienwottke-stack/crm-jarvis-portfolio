import { bewerteFunktionen, type WegweiserEintrag } from "@/lib/wegweiser";
import type { Suchtreffer } from "./modell";

export function funktionstreffer(eintraege: WegweiserEintrag[], q: string): Suchtreffer[] {
  return bewerteFunktionen(eintraege, q).map(({ eintrag: e, punkte }) => ({
    id: `funktionen:${e.id}`, typ: "funktionen", titel: e.titel, kontext: e.bereich, href: e.href, punkte,
  }));
}
