// Service Worker der Ergo-CRM-App (docs/willkommen-plan.md, Abschnitt 7.4).
//
// Drei Aufgaben, mehr nicht:
//   1. Chrome bietet das Installieren erst an, wenn ein Service Worker
//      registriert ist, der bei Netzausfall eine Antwort liefert. Ohne diese
//      Datei gibt es auf Android keinen Installieren-Knopf.
//   2. Eine ehrliche "Kein Netz"-Seite statt des Dino-Spiels.
//   3. Meldungen anzeigen und beim Antippen an die richtige Stelle springen.
//
// WICHTIG: Zwischengespeichert werden ausschliesslich unveraenderliche
// Dateien. Niemals HTML, niemals Antworten von Server-Actions. Das sind
// Kundendaten - eine Seite aus dem Cache im falschen Konto waere der
// schlimmste denkbare Fehler dieser App.

const CACHE = "ergo-crm-v1";

// Im Entwicklungsbetrieb registriert die App diese Datei als "/sw.js?dev=1".
// Dann bleibt der Cache aus: sonst bekaeme man nach jeder Aenderung die alten
// Next-Bundles ausgeliefert. Die Offline-Antwort funktioniert trotzdem.
const CACHE_AKTIV = !self.location.search.includes("dev=1");

// Die Offline-Seite und die Symbole. Mehr braucht die Schale nicht.
const SCHALE = [
  "/offline",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  if (!CACHE_AKTIV) {
    event.waitUntil(self.skipWaiting());
    return;
  }
  event.waitUntil(
    caches
      .open(CACHE)
      // Einzeln statt addAll: faellt ein Symbol aus, soll nicht die ganze
      // Installation scheitern und der Installieren-Knopf verschwinden.
      .then((cache) =>
        Promise.all(SCHALE.map((pfad) => cache.add(pfad).catch(() => undefined)))
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((namen) =>
        Promise.all(namen.filter((name) => name !== CACHE).map((name) => caches.delete(name)))
      )
      .then(() => self.clients.claim())
  );
});

// Nur was unter diesen Pfaden liegt, darf in den Cache: Next-Bundles tragen
// einen Hash im Namen, Symbole aendern sich praktisch nie.
function istUnveraenderlich(pfad) {
  return (
    pfad.startsWith("/_next/static/") ||
    pfad.startsWith("/icon") ||
    pfad === "/apple-touch-icon.png" ||
    pfad === "/favicon.ico"
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Seitenaufrufe: immer aus dem Netz, damit niemand fremde oder alte Daten
  // zu sehen bekommt. Nur wenn das Netz wegbleibt, kommt die Offline-Seite.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const offline = await caches.match("/offline");
        return (
          offline ??
          new Response("Kein Netz.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          })
        );
      })
    );
    return;
  }

  if (!CACHE_AKTIV || !istUnveraenderlich(url.pathname)) return;

  event.respondWith(
    caches.match(request).then((treffer) => {
      if (treffer) return treffer;
      return fetch(request).then((antwort) => {
        if (antwort.ok) {
          const kopie = antwort.clone();
          caches.open(CACHE).then((cache) => cache.put(request, kopie));
        }
        return antwort;
      });
    })
  );
});

// --- Meldungen ---------------------------------------------------------------
// Die Nutzlast kommt aus lib/push.ts und traegt immer ein Ziel mit. Eine
// Meldung ohne Ziel waere eine Nachricht ohne naechsten Schritt.

function sicheresZiel(value) {
  try {
    const ziel = new URL(value || "/heute", self.location.origin);
    if (ziel.origin === self.location.origin && ["http:", "https:"].includes(ziel.protocol)) {
      return ziel.pathname + ziel.search + ziel.hash;
    }
  } catch { /* Invalid targets fall back to the app. */ }
  return "/heute";
}

self.addEventListener("push", (event) => {
  let meldung = {};
  try {
    meldung = event.data ? event.data.json() : {};
  } catch {
    meldung = {};
  }

  const titel = meldung.titel || "Cockpit";
  event.waitUntil(
    self.registration.showNotification(titel, {
      body: meldung.text || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // Gleiche Kennung ersetzt eine offene Meldung, statt zu stapeln: drei
      // Erinnerungen uebereinander liest niemand, die dritte weckt nur Aerger.
      tag: meldung.kennung || "ergo-crm",
      renotify: Boolean(meldung.kennung),
      data: { url: sicheresZiel(meldung.url) },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const ziel = sicheresZiel(event.notification.data && event.notification.data.url);

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((fenster) => {
        // Laeuft die App schon, dort hinspringen statt ein zweites Fenster
        // aufzumachen - auf dem Handy waere das ein zweiter App-Eintrag.
        for (const client of fenster) {
          if (new URL(client.url).origin === self.location.origin) {
            return client.focus().then(() => client.navigate(ziel));
          }
        }
        return self.clients.openWindow(ziel);
      })
  );
});
