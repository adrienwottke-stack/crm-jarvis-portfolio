"use client";

// Der Schalter fuer Meldungen.
//
// Zwei Regeln, die die Umsetzung erklaeren:
//
// 1. NIE ungefragt nach der Erlaubnis fragen. Ein Browser-Dialog, der beim
//    ersten Seitenaufruf aufpoppt, wird weggeklickt - und danach laesst sich
//    die Erlaubnis nur noch in den Einstellungen des Telefons zurueckholen.
//    Ein verbranntes "Blockiert" ist dauerhaft. Deshalb erst der eigene Knopf,
//    der erklaert wofuer, und erst der Tipp darauf fragt.
// 2. Wer schon zugestimmt hat, sieht hier nichts mehr. Ein Schalter, der immer
//    dasteht, ist eine Zeile Oberflaeche ohne Zweck.

import { useEffect, useState } from "react";
import { aboSpeichern } from "@/app/(app)/pushActions";
import { BellIcon } from "@/components/icons";

// Der VAPID-Schluessel kommt Base64-URL-kodiert; der Browser will Bytes.
// Bewusst ueber einen eigenen ArrayBuffer: `new Uint8Array(n)` ist dem
// Typsystem nach auch ueber einem SharedArrayBuffer moeglich, und den nimmt
// `applicationServerKey` nicht an.
function schluesselZuBytes(base64: string): ArrayBuffer {
  const auffuellen = "=".repeat((4 - (base64.length % 4)) % 4);
  const roh = atob((base64 + auffuellen).replace(/-/g, "+").replace(/_/g, "/"));
  const puffer = new ArrayBuffer(roh.length);
  const bytes = new Uint8Array(puffer);
  for (let i = 0; i < roh.length; i += 1) bytes[i] = roh.charCodeAt(i);
  return puffer;
}

type Stand = "prüft" | "geht nicht" | "aus" | "blockiert" | "an" | "lädt";

export default function Meldungen({ vapidKey, userId, syncOnly = false }: { vapidKey: string; userId?: string; syncOnly?: boolean }) {
  const [stand, setStand] = useState<Stand>("prüft");
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window) ||
      !vapidKey
    ) {
      setStand("geht nicht");
      return;
    }
    if (Notification.permission === "denied") {
      setStand("blockiert");
      return;
    }

    let abgebrochen = false;
    void navigator.serviceWorker.ready.then(async (registrierung) => {
      const vorhanden = await registrierung.pushManager.getSubscription();
      if (abgebrochen) return;
      // Consent already exists. Rebind the existing device to the currently
      // authenticated account without another permission dialog or new push.
      if (vorhanden) {
        const daten = vorhanden.toJSON();
        await aboSpeichern({ endpoint: vorhanden.endpoint, p256dh: daten.keys?.p256dh ?? "", auth: daten.keys?.auth ?? "" });
      }
      if (abgebrochen) return;
      setStand(vorhanden ? "an" : "aus");
    }).catch(() => { if (!abgebrochen) setStand("aus"); });
    return () => {
      abgebrochen = true;
    };
  }, [vapidKey, userId]);

  const einschalten = async () => {
    setFehler(null);
    setStand("lädt");
    try {
      const erlaubnis = await Notification.requestPermission();
      if (erlaubnis !== "granted") {
        setStand(erlaubnis === "denied" ? "blockiert" : "aus");
        return;
      }

      const registrierung = await navigator.serviceWorker.ready;
      const abo =
        (await registrierung.pushManager.getSubscription()) ??
        (await registrierung.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: schluesselZuBytes(vapidKey),
        }));

      const daten = abo.toJSON();
      await aboSpeichern({
        endpoint: abo.endpoint,
        p256dh: daten.keys?.p256dh ?? "",
        auth: daten.keys?.auth ?? "",
      });
      setStand("an");
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Das hat nicht geklappt.");
      setStand("aus");
    }
  };

  if (syncOnly || stand === "prüft" || stand === "geht nicht" || stand === "an") return null;

  if (stand === "blockiert") {
    return (
      <p className="rounded-xl bg-sunken px-4 py-3 text-xs text-ink-muted">
        Meldungen sind für diese Seite blockiert. Das lässt sich nur in den
        Einstellungen deines Browsers wieder freigeben.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-navy-200 bg-navy-50/60 px-4 py-3">
      <p className="text-sm text-navy-900">
        <span className="font-semibold">Sag mir Bescheid.</span> Wenn ein Termin
        ansteht, dir jemand schreibt oder ein nützliches CRM-Update bereitsteht.
      </p>
      <button
        type="button"
        onClick={einschalten}
        disabled={stand === "lädt"}
        className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg bg-akzent px-4 text-sm font-semibold text-white transition hover:bg-akzent-stark disabled:opacity-60"
      >
        <BellIcon className="h-4 w-4" />
        {stand === "lädt" ? "Moment …" : "Einschalten"}
      </button>
      {fehler && <p className="w-full text-xs text-red-700">{fehler}</p>}
    </div>
  );
}
