// Umkehrbare Verschluesselung fuer Zugangsdaten fremder Dienste.
//
// ES IST WICHTIG, DASS DAS HIER NICHT MIT lib/auth.ts VERWECHSELT WIRD.
// Dort werden Passwoerter GEHASHT (PBKDF2, 310.000 Runden) - sie lassen sich
// danach nicht mehr herstellen, und genau das ist der Sinn. Hier werden
// Passwoerter VERSCHLUESSELT, also umkehrbar. Auch das ist Absicht, aber aus
// einem viel schwaecheren Grund: TimeTree hat seine Schnittstelle am
// 22.12.2023 abgeschaltet, es gibt keine Zugangsschluessel mehr, und die
// einzige verbliebene Anmeldung verlangt das Passwort im Klartext. Wer es
// spaeter benutzen will, muss es aufheben koennen.
//
// Daraus folgt eine Aussage, die auf der Quellen-Seite auch so dasteht:
// WER DIE DATENBANK UND KALENDER_SECRET HAT, HAT DAS PASSWORT.
// Gegenmittel ist kein Code, sondern eine Gewohnheit - fuer TimeTree ein
// eigenes Passwort, das nirgendwo sonst benutzt wird.
//
// AES-256-GCM ueber die Web-Crypto-API, wie in lib/auth.ts und lib/session.ts,
// damit es in jeder Laufzeit traegt.

const ALGORITHMUS = "AES-GCM";
const IV_LAENGE = 12; // 96 Bit, die von GCM vorgesehene Groesse

function geheimnis(): string {
  const wert = process.env.KALENDER_SECRET;
  if (!wert || wert.length < 32) {
    throw new Error(
      "KALENDER_SECRET fehlt oder ist zu kurz (mindestens 32 Zeichen)."
    );
  }
  return wert;
}

/** Ob ueberhaupt verschluesselt werden kann. Damit die Oberflaeche eine
 *  fehlende Einstellung als Hinweis zeigen kann statt als Absturz. */
export function verschluesselungBereit(): boolean {
  const wert = process.env.KALENDER_SECRET;
  return Boolean(wert && wert.length >= 32);
}

// Der Schluessel wird aus dem Geheimnis abgeleitet, statt es roh zu nehmen:
// so ist die Laenge immer richtig, egal wie lang die Umgebungsvariable ist.
async function schluessel(): Promise<CryptoKey> {
  const roh = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(geheimnis())
  );
  return crypto.subtle.importKey("raw", roh, ALGORITHMUS, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Klartext -> "base64(iv).base64(chiffre)". */
export async function verschluessele(klartext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LAENGE));
  const chiffre = await crypto.subtle.encrypt(
    { name: ALGORITHMUS, iv },
    await schluessel(),
    new TextEncoder().encode(klartext)
  );
  return `${Buffer.from(iv).toString("base64")}.${Buffer.from(chiffre).toString("base64")}`;
}

/** Zurueck. Wirft, wenn der Schluessel gewechselt hat oder etwas manipuliert
 *  wurde - GCM prueft die Unversehrtheit mit. */
export async function entschluessele(gespeichert: string): Promise<string> {
  const [ivTeil, chiffreTeil] = gespeichert.split(".");
  if (!ivTeil || !chiffreTeil) throw new Error("Unlesbarer Zugang.");

  const klartext = await crypto.subtle.decrypt(
    { name: ALGORITHMUS, iv: Buffer.from(ivTeil, "base64") },
    await schluessel(),
    Buffer.from(chiffreTeil, "base64")
  );
  return new TextDecoder().decode(klartext);
}
