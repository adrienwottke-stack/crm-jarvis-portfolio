export type Tagesmeldung = { titel: string; text: string; url: string; kennung: string };

/** Ein Nutzer erhält pro Cronlauf genau eine Nachricht, auch mit mehreren Arbeitsbereichen. */
export function tagesmeldungenBuendeln(meldungen: Tagesmeldung[]): Tagesmeldung | null {
  if (meldungen.length === 0) return null;
  if (meldungen.length === 1) return { ...meldungen[0], kennung: "tagesueberblick" };
  return {
    titel: "Heute für dich",
    text: meldungen.map((meldung) => `${meldung.titel}: ${meldung.text}`).join(" · "),
    url: "/heute",
    kennung: "tagesueberblick",
  };
}
