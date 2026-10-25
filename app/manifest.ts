import type { MetadataRoute } from "next";

// Macht aus "Zum Startbildschirm hinzufuegen" ein richtiges Symbol ohne
// Adressleiste. Kein App-Store-Aufwand - nur diese Datei plus die Icons.
export default function manifest(): MetadataRoute.Manifest {
  return {
    // Die Kennung der App. Steht fest und haengt bewusst NICHT an der
    // start_url: die Einladungsseite liefert ein eigenes Manifest mit anderer
    // start_url aus, und ohne gleiche id hielte Chrome das fuer eine zweite
    // App und legte ein zweites Symbol an.
    id: "/",
    name: "Cockpit",
    short_name: "Cockpit",
    description: "Namensliste und Kontakt-Tracking für dein Team",
    // Nicht direkt auf eine Seite, sondern auf die Weiche: /start entscheidet
    // je nach Anmeldung, wo es weitergeht (app/start/route.ts).
    start_url: "/start",
    scope: "/",
    display: "standalone",
    // Gilt nur fuer Handys - Fenster am Rechner dreht niemand hochkant, und
    // Chrome wie Safari ignorieren die Angabe dort.
    orientation: "portrait",
    background_color: "#0a101c",
    theme_color: "#0a101c",
    lang: "de",
    // Ein Fenster, nicht zehn. Ohne diese Zeile oeffnet jeder Klick auf einen
    // Link - aus einer Meldung, aus einer Mail - am Rechner ein weiteres
    // App-Fenster, und man arbeitet nach zwei Tagen in einem Stapel Kopien.
    // "navigate-existing" holt stattdessen das offene Fenster nach vorn und
    // schickt es auf die neue Seite.
    launch_handler: { client_mode: "navigate-existing" },
    // Was das hier ist, falls ein Verzeichnis fragt. Kostet nichts, und ohne
    // die Angabe sortiert der Rechner-Browser die App unter "Sonstiges".
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/icon-192.png", type: "image/png", sizes: "192x192", purpose: "any" },
      // Zweimal dieselbe Datei mit verschiedenem Zweck: "any" ist das Symbol,
      // das Android anzeigt, "maskable" das, was es in seine Form schneidet.
      // Steht nur "maskable" da, fehlt Android das grosse Symbol ganz.
      { src: "/icon-512.png", type: "image/png", sizes: "512x512", purpose: "any" },
      { src: "/icon-512.png", type: "image/png", sizes: "512x512", purpose: "maskable" },
    ],
  };
}
