/** General orientation needs no customer lookup and no model round trip. */
export function crmOrientationAnswer(message: string): string | null {
  const text = message.toLowerCase().replace(/\b(?:yo|ey|hey|jarvis|bitte|quasi|mal)\b/g, " ").replace(/\s+/g, " ").trim();
  const question = /^(?:[,! .]*)(?:was kann (?:ich|man) (?:alles )?(?:mit|in) (?:dem |diesem |unserem |meinem )?(?:crm|cm)(?: alles)? machen|was (?:kannst du|geht) (?:alles )?(?:im|mit dem) (?:crm|cm)|(?:wobei|wie) kannst du mir (?:im|mit dem) (?:crm|cm) helfen)[?!.\s,]*/i.exec(text);
  if (!question) return null;
  // Do not swallow a concrete follow-up, a person's name or a requested write.
  const rest = text.slice(question[0].length).replace(/[?!. ,]/g, " ").replace(/\s+/g, " ").trim();
  if (rest && !/^(?:hilf mir (?:ein bisschen |bisschen )?(?:dabei )?(?:was geht so)?|was geht so|zeig mir (?:die )?möglichkeiten|gib mir (?:einen )?überblick)$/.test(rest)) return null;
  return "Klar! Mit dem CRM kannst du Kontakte organisieren und deinen nächsten Schritt im Blick behalten. Ich kann dir dabei konkret helfen:\n\n"
    + "- **Deinen Tag planen:** Frag mich: „Was steht heute an?“\n"
    + "- **Kontakte finden und nachfassen:** Zum Beispiel: „Suche meinen Kontakt Anna“ oder „Bereite eine Wiedervorlage für morgen vor“.\n"
    + "- **Gespräche festhalten:** Erzähl mir, was besprochen wurde; ich bereite daraus einen Eintrag vor.\n"
    + "- **Partnergespräche vorbereiten:** Soweit du Zugriff hast, kann ich dokumentierte Notizen, Aufgaben und Vereinbarungen zusammenstellen.\n\n"
    + "Außerdem kann ich mit deinen bestehenden Rechten Listen und Pipeline bearbeiten, Termine verwalten, Ziele und Einheiten erfassen, interne Nachrichten senden, Einladungen und Strukturpersonen verwalten sowie Zinsrechner-Szenarien bearbeiten. Mit Verwaltungsrechten kommen Werkstatt und Kontoverwaltung hinzu. Ich prüfe dafür die verfügbaren Funktionen und echten Daten.\n\n"
    + "Änderungen zeige ich dir zuerst als Vorschau. Gespeichert wird erst nach deinem Klick auf die Bestätigung. Wollen wir mit deinem heutigen Tag anfangen?";
}
