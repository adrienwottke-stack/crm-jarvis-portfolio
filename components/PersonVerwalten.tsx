"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import { personVerwalten, type VerwaltungsErgebnis } from "@/app/(app)/mannschaft/verwaltungActions";
import type { Strukturperson } from "@/lib/struktur-verwaltung";
import { btnPrimary, btnSecondary, input, label } from "@/components/ui";

export default function PersonVerwalten({ person, stufen }: { person: Strukturperson; stufen: number[] }) {
  const [offen, setOffen] = useState<"bearbeiten" | "austragen" | "loeschen" | null>(null);
  const [ergebnis, setErgebnis] = useState<VerwaltungsErgebnis>({});
  const [pending, setPending] = useState(false);
  const [bestaetigung, setBestaetigung] = useState("");
  function oeffnen(aktion: typeof offen) { setErgebnis({}); setBestaetigung(""); setOffen(aktion); }
  async function speichern(formData: FormData) {
    if (pending) return;
    setPending(true);
    try {
      const result = await personVerwalten(formData);
      setErgebnis(result);
      if (result.fehler) return;
      // Erst nach bestätigtem Erfolg navigieren. Keine zweite Mutation und
      // kein Warten auf einen möglicherweise hängenbleibenden Router-Refresh.
      window.location.assign(result.geloescht
        ? "/mannschaft/verwalten?geloescht=1"
        : `/mannschaft/${person.id}?geaendert=${encodeURIComponent(String(formData.get("aktion")))}`);
    } catch { setErgebnis({ fehler: "Keine Verbindung. Bitte erneut versuchen." }); }
    finally { setPending(false); }
  }
  const aktion = offen === "austragen" && person.ausgetragen ? "zurueckholen" : offen;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button className={btnSecondary} onClick={() => oeffnen("bearbeiten")}>Bearbeiten</button>
        {!person.istDu && <>
          <button className={btnSecondary} onClick={() => oeffnen("austragen")}>{person.ausgetragen ? "Zurückholen" : "Austragen"}</button>
          <button className="inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-medium text-red-600 transition hover:bg-red-50" onClick={() => oeffnen("loeschen")}>Löschen</button>
        </>}
      </div>
      {!offen && ergebnis.erfolg && <p role="status" className="text-sm text-emerald-700">{ergebnis.erfolg}</p>}
      <Modal open={offen !== null} onClose={() => { if (!pending) setOffen(null); }}
        title={offen === "bearbeiten" ? "Person bearbeiten" : offen === "loeschen" ? "Person endgültig löschen?" : person.ausgetragen ? "Person zurückholen?" : "Person austragen?"} subtitle={person.name}>
        <form onSubmit={(event) => { event.preventDefault(); void speichern(new FormData(event.currentTarget)); }} className="space-y-4">
          <input type="hidden" name="userId" value={person.id} />
          <input type="hidden" name="aktion" value={aktion ?? ""} />
          {offen === "bearbeiten" && <>
            <div><label htmlFor={`person-name-${person.id}`} className={label}>Name</label><input id={`person-name-${person.id}`} className={input} name="name" defaultValue={person.name} required maxLength={60} /></div>
            <div><label htmlFor={`person-phone-${person.id}`} className={label}>Telefonnummer</label><input id={`person-phone-${person.id}`} className={input} name="phone" type="tel" defaultValue={person.phone ?? ""} maxLength={30} /></div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div><label htmlFor={`person-stufe-${person.id}`} className={label}>Karrierestufe</label><select id={`person-stufe-${person.id}`} className={input} name="karrierestufe" defaultValue={person.karrierestufe ?? ""}><option value="">Nicht eingetragen</option>{stufen.map((s) => <option key={s} value={s}>Stufe {s}</option>)}</select></div>
              <div><label htmlFor={`person-start-${person.id}`} className={label}>Eintrittsdatum</label><input id={`person-start-${person.id}`} className={input} name="startedAt" type="date" defaultValue={person.startedAt ?? ""} /></div>
            </div>
            <div><label htmlFor={`person-leader-${person.id}`} className={label}>Führungskraft</label><select id={`person-leader-${person.id}`} className={input} name="leaderId" defaultValue={person.leaderId ?? ""}>
              {person.admin && <option value="">Keine · eigene Wurzel</option>}
              {person.leaderId && !person.fuehrungskraefte.some((p) => p.id === person.leaderId) && <option value={person.leaderId}>Bisherige Zuordnung beibehalten</option>}
              {person.fuehrungskraefte.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select><p className="mt-1.5 text-xs text-ink-muted">Beim Wechsel zieht das Team dieser Person mit.</p></div>
          </>}
          {offen === "austragen" && <p className="text-sm text-ink-muted">{person.ausgetragen ? "Die Person kann die App wieder nutzen und zählt wieder in den laufenden Auswertungen mit." : "Der Zugang wird gesperrt. Daten und Struktur bleiben erhalten; du kannst die Person später zurückholen. Ihr Team bleibt aktiv."}</p>}
          {offen === "loeschen" && <>
            <p className="text-sm text-ink-muted">Das Konto und seine zugehörigen Daten werden unwiderruflich gelöscht, einschließlich {person.kontakte} Kontakte samt Aktivitäten, Einheiten und Ranglisten-Einträgen.</p>
            {person.gefuehrte > 0 && <p className="rounded-xl bg-sunken p-3 text-sm text-ink">Die {person.gefuehrte} direkt untergeordneten Personen rücken eine Ebene hoch. Ihre Teams und Daten bleiben erhalten.</p>}
            <p className="text-sm text-ink-muted">Bei einem Austritt kannst du stattdessen „Austragen“ wählen und die Historie behalten.</p>
            <div><label htmlFor={`confirm-${person.id}`} className={label}>Zur Bestätigung „{person.name}“ eingeben</label><input id={`confirm-${person.id}`} className={input} name="bestaetigung" autoComplete="off" value={bestaetigung} onChange={(e) => setBestaetigung(e.target.value)} required /></div>
          </>}
          {ergebnis.fehler && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{ergebnis.fehler}</p>}
          <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
            <button type="button" disabled={pending} className={btnSecondary} onClick={() => setOffen(null)}>Abbrechen</button>
            <button type="submit" disabled={pending || (offen === "loeschen" && bestaetigung.trim() !== person.name)} className={offen === "loeschen" ? "inline-flex min-h-11 items-center justify-center rounded-full bg-fest-gefahr px-5 text-sm font-medium text-white disabled:opacity-50" : `${btnPrimary} disabled:opacity-50`}>
              {pending ? "Wird gespeichert …" : offen === "bearbeiten" ? "Änderungen speichern" : offen === "loeschen" ? "Endgültig löschen" : person.ausgetragen ? "Zurückholen" : "Austragen"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
