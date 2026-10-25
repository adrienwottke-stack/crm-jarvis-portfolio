import Rahmen, { Schritt } from "./Rahmen";

// Das Teilen-Symbol von iOS: Kasten mit Pfeil nach oben. Wer den Namen nicht
// kennt, erkennt die Form - deshalb steht es mitten im Satz.
//
// HINWEIS: Hier gehoeren echte Bildschirmfotos hin, keine gezeichneten
// Symbole (docs/willkommen-plan.md, Abschnitt 6 und offener Punkt 6). Bis die
// da sind, traegt diese Zeichnung.
function TeilenSymbol() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="inline-block h-[1.15em] w-[1.15em] translate-y-[0.15em] fill-none stroke-akzent"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 15V3" />
      <path d="m8 7 4-4 4 4" />
      <path d="M7 11H5.5A1.5 1.5 0 0 0 4 12.5v7A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5H17" />
    </svg>
  );
}

// Der iPhone-Zweig. Safari kennt keinen Installieren-Knopf, den wir ausloesen
// koennten - hier gibt es nur den Weg ueber das Teilen-Menue.
export default function IphoneAnleitung() {
  return (
    <Rahmen
      kicker="Drei Schritte"
      titel="Das hier gehört auf deinen Startbildschirm"
      text={
        <>
          <p>
            Cockpit ist kein Lesezeichen. Es ist die App, in der du morgens siehst,
            wer heute dran ist – und die dich daran erinnert.
          </p>
          <p>Dein iPhone macht das über das Teilen-Menü.</p>
        </>
      }
    >
      <ol className="glas-dunkel space-y-4 rounded-2xl border border-white/10 p-5">
        <Schritt nummer={1}>
          Tippe unten in der Leiste auf <TeilenSymbol />
        </Schritt>
        <Schritt nummer={2}>
          Scrolle in der Liste nach unten zu{" "}
          <strong>„Zum Home-Bildschirm“</strong>
        </Schritt>
        <Schritt nummer={3}>
          Oben rechts auf <strong>„Hinzufügen“</strong> – fertig
        </Schritt>
      </ol>
      <p className="mt-6 text-13 leading-relaxed text-navy-300">
        Danach öffnest du Cockpit über das neue Symbol und legst dort deinen Zugang
        an. Nicht mehr hier im Browser – sonst musst du dich gleich zweimal anmelden.
      </p>
    </Rahmen>
  );
}
