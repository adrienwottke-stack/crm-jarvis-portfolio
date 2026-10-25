// Die vier Erkennungen der Installations-Schleuse an genau einer Stelle
// (docs/willkommen-plan.md, Abschnitt 7.2).
//
// Alles hier laeuft im Browser - der Server kann keine dieser Fragen
// beantworten. Und alles hier ist Fuehrung, keine Sicherheitsgrenze: wer die
// Erkennung umgehen will, kann das. Fuer den Zweck reicht es.

export type Zweig =
  | "unbekannt" // noch nicht entschieden (erster Renderdurchlauf)
  | "inapp" // WhatsApp-/Instagram-Browser: kann nicht installieren
  | "rechner" // kein Handy: QR-Code, sonst nichts
  | "app" // laeuft schon vom Startbildschirm: freie Fahrt
  | "iphone"
  | "android";

function kennung(): string {
  return typeof navigator === "undefined" ? "" : navigator.userAgent;
}

/** iPhone, iPad oder ein Mac mit Touch (iPadOS meldet sich als Mac). */
export function istApple(): boolean {
  const ua = kennung();
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
}

/**
 * Eingebettete Browser von WhatsApp, Instagram, Facebook und Co.
 *
 * Auf Android sind das WebViews, erkennbar am "; wv" in der Kennung. Auf iOS
 * sieht die Kennung fast aus wie Safari - dort verraet es sich anders:
 * navigator.standalone gibt es nur im echten Safari, in einer WKWebView ist es
 * undefined.
 *
 * Die Kennungen aendern sich staendig. Deshalb ist dieser Zweig so gebaut,
 * dass ein Fehlalarm nicht schadet: er zeigt den Weg in den echten Browser und
 * laesst den Link kopieren - weiter geht es immer.
 */
export function istInAppBrowser(): boolean {
  const ua = kennung();
  if (!ua) return false;
  if (/\bwv\b|FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Snapchat/i.test(ua)) {
    return true;
  }
  if (istApple() && /Mobile/i.test(ua)) {
    return (navigator as Navigator & { standalone?: boolean }).standalone === undefined;
  }
  return false;
}

/**
 * Handy oder Tablet. Ein Notebook mit Touchscreen faellt nicht darauf herein,
 * weil dessen Hauptzeiger die Maus ist und damit "fine" meldet.
 */
export function istHandy(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: coarse) and (max-width: 1024px)").matches;
}

/** Laeuft die Seite vom Startbildschirm statt im Browser-Tab? */
export function laeuftAlsApp(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  // iOS kennt display-mode nicht zuverlaessig, dafuer aber diese Eigenschaft.
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Die Reihenfolge ist Absicht: "kein Handy" wird vor "schon installiert"
 * geprueft. Sonst kaeme jemand durch, der die App am Rechner installiert hat -
 * und genau das wollen wir nicht.
 */
export function zweigErmitteln(): Zweig {
  if (istInAppBrowser()) return "inapp";
  if (!istHandy()) return "rechner";
  if (laeuftAlsApp()) return "app";
  return istApple() ? "iphone" : "android";
}

// --- Der Rechner ------------------------------------------------------------
//
// Bis hierhin kannte diese Datei den Rechner nur als "falsches Geraet". Das
// gilt weiter fuer die EINLADUNG: ein Konto entsteht am Handy, weil dort
// telefoniert wird und weil es Meldungen auf dem iPhone ausschliesslich in
// einer installierten App gibt (docs/willkommen-plan.md, 7.4).
//
// Wer sein Konto hat, arbeitet daneben aber laengst am Schreibtisch: Namen
// nachtragen, Kalender sortieren, Mannschaft durchgehen. Dafuer braucht es
// keine zweite Anmeldung und keine Ausnahme - nur die Auskunft, wie die App
// auf diesem Rechner in ein eigenes Fenster kommt. Genau die geben die
// folgenden zwei Funktionen.

/** Welcher Weg fuehrt auf diesem Geraet zur installierten App? */
export type Installationsweg =
  | "chromium" // Chrome, Edge, Brave, Opera: Knopf, den wir selbst ausloesen
  | "safari" // Safari am Mac: "Ablage > Zum Dock hinzufuegen"
  | "safari-touch" // iPad (und iPhone): Teilen-Menue
  | "firefox" // kann keine Web-Apps installieren - dazu stehen wir
  | "andere";

export function installationsweg(): Installationsweg {
  const ua = kennung();
  if (!ua) return "andere";

  // Die Reihenfolge ist Absicht: Chrome und Edge tragen "Safari" in ihrer
  // Kennung mit, umgekehrt nicht. Wer zuerst auf Safari prueft, haelt jeden
  // Chrome fuer einen Safari - und zeigt eine Anleitung, die es dort nicht gibt.
  if (/Edg\/|OPR\/|Chrome\/|Chromium\//i.test(ua)) return "chromium";
  if (/Firefox\/|FxiOS/i.test(ua)) return "firefox";
  if (/Safari\//i.test(ua)) {
    // iPad meldet sich seit iPadOS 13 als Macintosh. Der Unterschied steckt
    // nur noch im Touchscreen - und die Anleitung ist eine voellig andere.
    return istApple() && navigator.maxTouchPoints > 1 ? "safari-touch" : "safari";
  }
  return "andere";
}

/**
 * Laeuft die Seite in einem Browser-Tab an einem Rechner?
 *
 * Also: kein Handy, nicht bereits als App gestartet. Das ist die einzige Lage,
 * in der ein Hinweis auf die Installation etwas nuetzt.
 */
export function amRechnerImTab(): boolean {
  return !istHandy() && !laeuftAlsApp();
}
