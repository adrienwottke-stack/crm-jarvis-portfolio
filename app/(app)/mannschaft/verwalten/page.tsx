import PersonLink from "@/components/PersonLink";
import { requireUser } from "@/lib/auth";
import { ladeStrukturverwaltung } from "@/lib/struktur-verwaltung";
import { card, pageTitle, filterPill, kicker } from "@/components/ui";

export default async function StrukturVerwalten({ searchParams }: { searchParams: Promise<{ status?: string; geloescht?: string }> }) {
  const user = await requireUser();
  const [personen, filter] = await Promise.all([ladeStrukturverwaltung(user.id), searchParams]);
  const ausgetragen = filter.status === "ausgetragen";
  const sichtbar = personen.filter((p) => p.ausgetragen === ausgetragen);
  return (
    <div className="space-y-6">
      <div><PersonLink href="/mannschaft" className="inline-flex min-h-11 items-center text-sm font-medium text-navy-700">← Team</PersonLink><h1 className={pageTitle}>Struktur verwalten</h1><p className="mt-2 text-sm text-ink-muted">Person auswählen, Aktivitäten ansehen und Angaben bearbeiten.</p></div>
      {filter.geloescht === "1" && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">Person gelöscht. Untergeordnete Teams bleiben erhalten.</p>}
      <nav className="flex gap-2" aria-label="Personen filtern">
        <PersonLink href="/mannschaft/verwalten" aria-current={!ausgetragen ? "page" : undefined} className={filterPill(!ausgetragen)}>Aktiv ({personen.filter((p) => !p.ausgetragen).length})</PersonLink>
        <PersonLink href="/mannschaft/verwalten?status=ausgetragen" aria-current={ausgetragen ? "page" : undefined} className={filterPill(ausgetragen)}>Ausgetragen ({personen.filter((p) => p.ausgetragen).length})</PersonLink>
      </nav>
      <section className={`${card} overflow-hidden`}>
        {sichtbar.length === 0 ? <p className="p-5 text-sm text-ink-muted">{ausgetragen ? "Keine ausgetragenen Personen in deiner Struktur." : "Hier erscheinen die Personen deiner Struktur, sobald du jemanden aufnimmst oder einlädst."}</p> :
          <ul className="divide-y divide-line">{sichtbar.map((p) => <li key={p.id}><PersonLink href={`/mannschaft/${p.id}`} className="flex min-h-16 items-center justify-between gap-3 px-5 py-4 transition hover:bg-sunken"><div><p className="font-semibold text-ink">{p.name}</p><p className={kicker}>{p.fuehrungskraft ? `Unter ${p.fuehrungskraft}` : "Eigene Wurzel"}</p></div><span aria-hidden className="text-ink-soft">›</span></PersonLink></li>)}</ul>}
      </section>
    </div>
  );
}
