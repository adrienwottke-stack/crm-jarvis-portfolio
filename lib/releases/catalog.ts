/** Content only. Availability and dispatch require a confirmed publication. */
export type Release = {
  id: string;
  date: string;
  title: string;
  benefit: string;
  changes: readonly string[];
  action: { label: string; href: string };
};

export const RELEASES: readonly Release[] = [
  {
    id: "crm-2026-10-05-workflows",
    date: "2026-10-05",
    title: "Gespräche mit Jarvis vorbereiten und festhalten",
    benefit: "Finde den Gesprächskontext schneller und behalte den Überblick über gespeicherte Ergebnisse.",
    changes: [
      "Jarvis berücksichtigt aktuelle Kontaktquellen und benennt fehlende Angaben.",
      "Schreiben und Sprachchat sind über eine gemeinsame Eingabe erreichbar.",
      "Neuigkeiten bleiben jederzeit erreichbar; bestätigte Updates werden auf deinen Geräten gemerkt.",
    ],
    action: { label: "Kontakt für ein Gespräch wählen", href: "/contacts" },
  },
];

export function findRelease(id: string): Release | undefined {
  return RELEASES.find(release => release.id === id);
}

export function validateRelease(release: Release): void {
  if (!/^[a-z0-9-]+$/.test(release.id) || !/^\d{4}-\d{2}-\d{2}$/.test(release.date)) throw new Error("Ungültige Release-Kennung oder Datum.");
  if (!release.title.trim() || !release.benefit.trim() || release.changes.length < 1 || release.changes.length > 3) throw new Error("Ein Release benötigt Nutzen und höchstens drei Änderungen.");
  if (!release.action.href.startsWith("/") || release.action.href.startsWith("//") || !release.action.label.trim()) throw new Error("Die Release-Aktion muss in die App führen.");
}
