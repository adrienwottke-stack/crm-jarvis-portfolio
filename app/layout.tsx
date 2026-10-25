import type { Metadata, Viewport } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./emil.css";
import "./assistant.css";
import "./workspace.css";
import "./planning-workspace.css";
import "./contacts-workspace.css";
import AssistantProvider from "@/components/ai-crm/AssistantProvider";
import VorfuehrProvider from "@/components/VorfuehrProvider";
import ServiceWorkerRegistrierung from "@/components/ServiceWorkerRegistrierung";

// Chrome meldet die Installierbarkeit ueber "beforeinstallprompt" - und zwar
// frueh, oft bevor React ueberhaupt haengt. Wer erst in einer Komponente
// zuhoert, verpasst das Ereignis und hat einen Knopf ohne Wirkung. Deshalb
// dieser Dreizeiler direkt im HTML: er faengt das Ereignis auf, haelt es fest
// und sagt der Schleuse per eigenem Ereignis Bescheid.
const INSTALL_MITSCHNITT = `window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__ergoInstall=e;window.dispatchEvent(new Event('ergo-install-bereit'))});`;

// Die gemerkte Ansicht muss VOR dem ersten Anzeigen stehen, sonst blitzt beim
// Laden kurz die helle Seite auf, bevor React die Klasse setzt - das sieht wie
// ein Fehler aus. Deshalb hier, im Kopf, ohne React: liest die Einstellung,
// faellt auf die Geraetevorgabe zurueck und setzt die Klasse sofort.
// Der try/catch ist noetig, weil localStorage in manchen Browsern (privater
// Modus, gesperrte Cookies) beim blossen Zugriff wirft.
const THEMA_VORLAUF = `(function(){try{var t=localStorage.getItem('ergo-thema')||'dunkel';var d=t==='dunkel'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){}})();`;
const VORFUEHR_VORLAUF = `(function(){try{document.documentElement.dataset.presenting=sessionStorage.getItem('cockpit-vorfuehren')==='1'?'true':'false'}catch(e){}})();`;

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cockpit",
  description: "Kontakt-Tracking für dein Team",
  // Am Handy laeuft die Anwendung ueber "Zum Startbildschirm hinzufuegen"
  // wie eine eigene App: eigenes Symbol, keine Adressleiste.
  // Die blickdichte Statusleiste passt zur festen App-Kopfzeile.
  appleWebApp: {
    capable: true,
    title: "Cockpit",
    statusBarStyle: "default",
  },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  // Die Browser-Umrandung setzt die jeweilige Canvas-Farbe fort.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f8" },
    { media: "(prefers-color-scheme: dark)", color: "#171717" },
  ],
  // Die Kopfzeile ist klebrig und die Ergebnis-Knoepfe sitzen unten – ohne
  // viewportFit verschwinden sie am iPhone hinter der Home-Leiste.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: das Skript unten setzt die Klasse "dark" schon
    // vor React. Ohne den Hinweis meldet React genau diesen Unterschied.
    <html lang="de" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEMA_VORLAUF }} />
        <script dangerouslySetInnerHTML={{ __html: VORFUEHR_VORLAUF }} />
        <script dangerouslySetInnerHTML={{ __html: INSTALL_MITSCHNITT }} />
      </head>
      <body
        className={`${inter.variable} ${geistMono.variable} font-sans antialiased`}
      >
        <VorfuehrProvider><AssistantProvider>{children}</AssistantProvider></VorfuehrProvider>
        <ServiceWorkerRegistrierung />
      </body>
    </html>
  );
}
