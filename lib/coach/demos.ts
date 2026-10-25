import type { DemoId } from "@/lib/coach/model";

export type DemoFrame = { caption: string; field?: string; value?: string; choices?: string[]; selected?: string; button: string };
export type CoachDemo = { title: string; text: string; screen: string; frames: readonly DemoFrame[] };

export const COACH_DEMOS: Record<DemoId, CoachDemo> = {
  names: {
    title: "Ein Name nach dem anderen.",
    text: "Du musst noch nicht wissen, wen du anrufst. Schreib erst mal auf, wen du kennst.",
    screen: "Namen sammeln · Familie",
    frames: [
      { caption: "Denk an eine Person aus deiner Familie.", field: "Name", value: "Anna Beispiel", button: "Hinzufügen" },
      { caption: "Mit Hinzufügen wird der Name gespeichert.", field: "Name", value: "Anna Beispiel", button: "Hinzufügen", selected: "Hinzufügen" },
      { caption: "Dann der nächste Name oder der nächste Bereich.", choices: ["Anna Beispiel ✓"], button: "Nächster Bereich" },
    ],
  },
  phone: {
    title: "Jetzt wird’s erreichbar.",
    text: "Schau in deine Kontakte. Die Nummer einer Person reicht, um loszulegen.",
    screen: "Nummer ergänzen · Anna Beispiel",
    frames: [
      { caption: "Öffne die Person ohne Telefonnummer.", field: "Telefonnummer", value: "", button: "Nummer speichern" },
      { caption: "Trage ihre Telefonnummer ein.", field: "Telefonnummer", value: "0151 ··· ····", button: "Nummer speichern" },
      { caption: "Speichern – und den ersten Anruf vorbereiten.", field: "Telefonnummer", value: "0151 ··· ····", button: "Nummer speichern", selected: "Nummer speichern" },
    ],
  },
  call: {
    title: "Den ersten Satz hast du schon.",
    text: "Der Leitfaden hilft dir beim Einstieg. Du startest den Anruf selbst und trägst danach das Ergebnis ein.",
    screen: "Anrufdurchlauf · Anna Beispiel",
    frames: [
      { caption: "Öffne vor dem Anruf den passenden Leitfaden.", choices: ["Leitfaden", "Hallo Anna, hast du kurz Zeit?"], selected: "Leitfaden", button: "0151 ··· ····" },
      { caption: "Die Telefonnummer öffnet deine Telefon-App.", choices: ["Anna Beispiel"], button: "0151 ··· ····", selected: "0151 ··· ····" },
      { caption: "Nach der Rückkehr trägst du ein, was passiert ist.", choices: ["Termin", "Nicht erreicht", "Später", "Kein Interesse"], button: "Dein Ergebnis wählen" },
    ],
  },
  "call-result": {
    title: "Wie lief’s wirklich?",
    text: "Auch nicht erreicht ist ein Ergebnis. Trag es ein, damit dein nächster Schritt stimmt.",
    screen: "Anrufergebnis · Anna Beispiel",
    frames: [
      { caption: "Wähle das tatsächliche Ergebnis.", choices: ["Termin", "Nicht erreicht", "Später", "Kein Interesse"], button: "Ergebnis wählen" },
      { caption: "Bei einem Termin ergänzt du Datum und Uhrzeit.", field: "Termin", value: "Donnerstag · 16:00", button: "Termin speichern" },
      { caption: "Erst das Speichern zählt. Danach geht’s weiter.", field: "Termin", value: "Donnerstag · 16:00", button: "Termin speichern", selected: "Termin speichern" },
    ],
  },
  appointment: {
    title: "Dein Termin hat seinen Platz.",
    text: "Du findest ihn im Kalender und auf Heute. Nach dem Gespräch trägst du dort das Ergebnis ein.",
    screen: "Kalender · Beispielwoche",
    frames: [
      { caption: "Im Kalender steht dein gespeicherter Termin.", choices: ["Do · 16:00 · Anna Beispiel"], button: "Termin ansehen" },
      { caption: "Öffne den Termin für die Kontaktdetails.", choices: ["Do · 16:00 · Anna Beispiel"], button: "Termin ansehen", selected: "Termin ansehen" },
      { caption: "Nach dem Termin: Gehalten oder Geplatzt wählen.", choices: ["Gehalten", "Geplatzt"], button: "Ergebnis eintragen" },
    ],
  },
  result: {
    title: "Was kam raus – und wer noch?",
    text: "Empfehlungen und Terminergebnis gehören zusammen. Auch ohne Empfehlung und ohne Abschluss geht’s weiter.",
    screen: "Termin gehalten · Anna Beispiel",
    frames: [
      { caption: "Empfohlene Namen eintragen – falls es welche gibt.", field: "Empfehlung", value: "Ben Beispiel", button: "Ergebnis wählen" },
      { caption: "Keine Empfehlung? Lass das Namensfeld leer.", field: "Empfehlung", value: "", button: "Ergebnis wählen" },
      { caption: "Dein Ergebnis speichert auch die Empfehlungen.", choices: ["Abschluss", "Noch offen", "Kein Abschluss"], selected: "Noch offen", button: "Mit dem Ergebnis speichern" },
    ],
  },
  units: {
    title: "Jetzt stehen auch die Einheiten.",
    text: "Trage die Einheiten zu deinem Abschluss ein. Fehlt die Zahl noch, erinnert dich die App später daran.",
    screen: "Einheiten · Beispielabschluss",
    frames: [
      { caption: "Die Einheitenfrage folgt nach dem gespeicherten Abschluss.", field: "Einheiten", value: "", button: "Einheiten eintragen" },
      { caption: "Trage die tatsächliche Zahl ein.", field: "Einheiten", value: "12,50", button: "Einheiten eintragen" },
      { caption: "Speichern. Bei Später bleibt eine Erinnerung offen.", field: "Einheiten", value: "12,50", button: "Einheiten eintragen", selected: "Einheiten eintragen" },
    ],
  },
  complete: {
    title: "Die erste Runde steht.",
    text: "Namen, Gespräche, Termine, neue Namen. Du kennst den Weg – und ich bleibe zum Nachsehen hier.",
    screen: "So geht’s weiter",
    frames: [
      { caption: "Mit Empfehlungen füllt sich deine Liste wieder.", choices: ["Neue Namen → Anrufen"], button: "Meine Kontakte" },
      { caption: "Aus Gesprächen werden die nächsten Termine.", choices: ["Anrufen → Termin → Ergebnis"], button: "Meine Kontakte" },
      { caption: "Wenn du etwas nachsehen möchtest, tippe auf Emil.", choices: ["Emil, hilf mir"], button: "Meine Kontakte" },
    ],
  },
};
