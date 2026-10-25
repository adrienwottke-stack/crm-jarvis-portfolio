/** Verified in-product destinations, shared by manual help and Jarvis. */
export const CRM_HELP = [
  { id: "contacts", title: "Kontakte und Namen", detail: "Unter Kontakte findest du Verkauf und Recruiting. Suche nach Name oder Telefonnummer, filtere nach Status und öffne den Kontakt. Namen sammeln bleibt in der Navigation erreichbar.", link: "/namen" },
  { id: "tasks", title: "Termine und nächste Schritte", detail: "Heute zeigt anstehende Aufgaben. Im Kontakt kannst du offene Wiedervorlagen auf morgen verschieben oder erledigen. Im Kalender legst du Termine über Eintrag an.", link: "/kalender" },
  { id: "voice", title: "Mit Jarvis arbeiten", detail: "Öffne Jarvis und wähle Sprachchat starten. Erst dann wird das Mikrofon angefragt. Nachricht diktieren erstellt einen Textentwurf. Prüfe Änderungsvorschläge vor dem Speichern; bearbeitete Vorschläge brauchen eine neue Bestätigung.", link: "/assistent" },
  { id: "support", title: "Rückmeldung und Support", detail: "Eine Rückmeldung kannst du über die vorhandene Rückmeldefunktion an die Administration senden. Profil und Einstellungen enthält auch Darstellung, App-Installation und Kalenderverbindungen.", link: "/hilfe#rueckmeldung" },
] as const;
