import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { ladeHauptziel, ladeZiele } from "@/lib/ziele";
import { zielPruefzeit } from "@/lib/ziele-modell";
import { ladeEinheitenErinnerungen } from "@/lib/einheiten-erinnerung";
import ZielKarte from "@/components/ziele/ZielKarte";
import Teamziele from "@/components/ziele/Teamziele";
import { shell, btnPrimary } from "@/components/ui";
import SeitenKopf from "@/components/SeitenKopf";
import VorfuehrVerdeckt from "@/components/VorfuehrVerdeckt";
import { ladeNavigationZugriff } from "@/lib/navigation-access";
import { BEREICHSNAVIGATION, visibleNavigation } from "@/lib/navigation";

export const dynamic = "force-dynamic";

export default async function FortschrittPage() {
  const user = await requireUser();
  const [ziele, hauptziel, erinnerungen, access] = await Promise.all([
    ladeZiele(user.id),
    ladeHauptziel(user.id),
    ladeEinheitenErinnerungen(user.id, true),
    ladeNavigationZugriff(user),
  ]);
  const eigene = ziele.filter((ziel) => ziel.inhaberId === user.id);
  const partnerZiele = ziele.filter((ziel) => ziel.inhaberId !== user.id);
  const laufend = eigene.filter(
    (ziel) =>
      !ziel.archiviertAt &&
      ziel.ende > zielPruefzeit(ziel.zeitraum) &&
      ziel.zusage !== "ABGELEHNT",
  ).sort((a, b) => Number(b.aktiv) - Number(a.aktiv));
  const vergangen = eigene.filter((ziel) => !laufend.includes(ziel));
  return (
    <div className={`${shell} crm-progress space-y-6`}>
      <SeitenKopf
        hauptbereich
        titel="Fortschritt"
        unterzeile="Deine eigene Leistung und deine Ziele."
        aktion={<Link className={btnPrimary} href="/fortschritt/neu">Ziel setzen</Link>}
      />
      <section id="ziele" className="scroll-mt-8 space-y-4">
        <div className="crm-section-heading">
          <h2>Deine Ziele</h2>
          <span className="text-sm text-ink-muted">{laufend.length} laufend</span>
        </div>
        {laufend.length === 0 ? (
          <div className="crm-work-section p-4">
            <p className="font-semibold">Setze dir ein neues Ziel.</p>
            <p className="mt-1 text-sm text-ink-muted">Ein Wochenziel genügt. Deinen Stand zählen wir aus deiner eingetragenen Arbeit.</p>
            <Link className="crm-planning-inline-link mt-2" href="/fortschritt/neu">Ziel setzen →</Link>
          </div>
        ) : (
          <div className="crm-goals-grid">
          {laufend.map((ziel) => (
            <ZielKarte
              key={ziel.id}
              ziel={ziel}
              userId={user.id}
              hauptzielId={hauptziel?.id ?? null}
              kompakt
            />
          ))}
          </div>
        )}
      </section>
      {access.unitsEnabled && erinnerungen.length > 0 ? (
        <Link href="/fortschritt/einheiten-offen" className="crm-planning-action-row">
          <span><strong>{erinnerungen.length} offene {erinnerungen.length === 1 ? "Einheitenmeldung" : "Einheitenmeldungen"}</strong><span className="block text-sm text-ink-muted">Abschlüsse vervollständigen</span></span>
          <span aria-hidden>→</span>
        </Link>
      ) : laufend.length > 0 ? (
        <Link href="/heute" className="crm-planning-action-row"><span>Zu deinen nächsten Schritten auf Heute</span><span aria-hidden>→</span></Link>
      ) : null}
      <section className="space-y-2">
        <div className="crm-section-heading"><h2>Deine Arbeit auswerten</h2></div>
        <nav aria-label="Fortschritt entdecken" className="crm-planning-tool-list">
          {visibleNavigation(BEREICHSNAVIGATION.fortschritt, access).filter(entry => ["progress-units", "progress-funnel"].includes(entry.id)).map(entry => <Link key={entry.id} href={entry.href}><span>{entry.label}</span><span className="text-sm text-ink-muted">{entry.id === "progress-units" ? "Eintragen und Entwicklung ansehen" : "Vom Anruf bis zum Ergebnis"}</span><span aria-hidden>→</span></Link>)}
        </nav>
      </section>
      <Teamziele userId={user.id} kompakt alsAbschnitt />
      {partnerZiele.length > 0 && (
        <details className="crm-planning-details">
          <summary>Partnerziele · {partnerZiele.length}</summary>
          <VorfuehrVerdeckt hinweis="Persönliche Partnerziele sind beim Vorführen ausgeblendet.">
            <div className="crm-goals-grid mt-3">{partnerZiele.map((ziel) => <ZielKarte key={ziel.id} ziel={ziel} userId={user.id} hauptzielId={null} kompakt />)}</div>
          </VorfuehrVerdeckt>
        </details>
      )}
      <nav aria-label="Weitere Fortschrittsbereiche" className="crm-planning-tool-list">
        <Link href="/arena"><span>Wettbewerb</span><span className="text-sm text-ink-muted">Gemeinsam dranbleiben</span><span aria-hidden>→</span></Link>
        <Link href="/fortschritt/warum"><span>Mein Warum</span><span className="text-sm text-ink-muted">Wofür du das machst</span><span aria-hidden>→</span></Link>
      </nav>
      {vergangen.length > 0 && (
        <details className="crm-planning-details">
          <summary>
            Frühere Ziele · {vergangen.length}
          </summary>
          <div className="crm-goals-grid mt-3">
            {vergangen.map((ziel) => (
              <ZielKarte
                key={ziel.id}
                ziel={ziel}
                userId={user.id}
                hauptzielId={null}
                kompakt
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
