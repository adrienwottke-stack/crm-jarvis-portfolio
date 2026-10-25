// Kurznachrichten zwischen Partnern (docs/audit-kernmodell.md, 10.6).
//
// Bewusst kein Chat: eine Nachricht ist eine Reaktion auf etwas, das gerade in
// der Rangliste passiert ist. Wer sich unterhalten will, hat WhatsApp.
//
// Liegt in lib/ und nicht neben der Server-Action: "use server"-Module duerfen
// ausschliesslich async Funktionen exportieren - eine Konstante daneben bricht
// den Produktionsbau, und nur den (tsc und eslint sehen die Regel nicht).

export const NACHRICHT_MAX_ZEICHEN = 200;

// Was ohne Tippen geht. Vier Reaktionen decken ab, was in diesem Moment
// ueberhaupt gesagt wird - alles andere laesst sich tippen.
export const SCHNELLTEXTE = [
  "Respekt!",
  "Stark gemacht.",
  "Das hol ich mir zurück.",
  "Kopf hoch — morgen wieder.",
];

// Aus der Mannschafts-Uebersicht heraus spricht eine Fuehrungskraft, kein
// Konkurrent. Die Frühwarn-Signale nennen jeweils einen naechsten Schritt
// ("Anrufen", "Begleitung vereinbaren") - bis hierhin gab es dafuer keinen
// Knopf, und der Schritt passierte in WhatsApp oder gar nicht.
//
// Der dritte Satz ist der Begleittermin (docs/audit-kernmodell.md, 10.7). Er
// legt bewusst KEINEN gemeinsamen Termin an: dafuer braeuchte es einen zweiten
// Terminbegriff ueber zwei Konten, und ein halb gebauter waere schlimmer als
// keiner. Ein Satz, der ankommt, loest das Gespraech aus - den Termin machen
// die beiden dann miteinander.
export const SCHNELLTEXTE_FUEHRUNG = [
  "Wie läuft's gerade bei dir?",
  "Lass uns diese Woche telefonieren.",
  "Ich komme zu deinem nächsten Termin mit.",
  "Melde dich, wenn's hakt — jederzeit.",
];
