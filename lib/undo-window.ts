// Bewusst eine eigene Datei: lib/undo.ts importiert Prisma, und die
// Rueckgaengig-Leiste im Browser braucht nur diese Zahl. Wuerde sie dort
// importieren, landete der Postgres-Treiber im Browser-Bundle.

/** So lange bietet die Oberflaeche das Zuruecknehmen an. */
export const UNDO_WINDOW_SECONDS = 30;
