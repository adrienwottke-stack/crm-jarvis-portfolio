"use client";

// Ein Wort an einen Kollegen, direkt aus der Rangliste.
//
// Der Moment zaehlt: jemand zieht an dir vorbei, jemand schliesst ab - dann
// will man etwas sagen, und zwar sofort und kurz. Deshalb vier fertige
// Reaktionen und ein Feld darunter, kein Postfach und kein Verlauf.

import { useState, useTransition } from "react";
import Modal from "@/components/Modal";
import { nachrichtSenden } from "@/app/(team)/nachrichtAction";
import { NACHRICHT_MAX_ZEICHEN, SCHNELLTEXTE } from "@/lib/nachrichten";
import { btnPrimary, inputBlank } from "@/components/ui";

export default function NachrichtSenden({
  anId,
  name,
  schnelltexte = SCHNELLTEXTE,
  variante = "symbol",
}: {
  anId: string;
  name: string;
  /** Die vier fertigen Saetze. In der Mannschaft spricht eine Fuehrungskraft,
      in der Arena ein Konkurrent - das sind andere Saetze. */
  schnelltexte?: readonly string[];
  /** "symbol" = Briefchen in einer Tabellenzeile, "knopf" = beschriftet. */
  variante?: "symbol" | "knopf";
}) {
  const [offen, setOffen] = useState(false);
  const [eigener, setEigener] = useState("");
  const [gesendet, setGesendet] = useState(false);
  const [pending, startTransition] = useTransition();

  const senden = (text: string) => {
    const sauber = text.trim();
    if (!sauber) return;
    const data = new FormData();
    data.set("anId", anId);
    data.set("text", sauber);
    startTransition(async () => {
      await nachrichtSenden(data);
      setGesendet(true);
      setEigener("");
      // Kurz stehen lassen, damit die Bestaetigung ankommt.
      setTimeout(() => {
        setOffen(false);
        setGesendet(false);
      }, 900);
    });
  };

  return (
    <>
      {variante === "knopf" ? (
        <button
          type="button"
          onClick={() => setOffen(true)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3.5 text-13 font-medium text-ink-muted transition hover:bg-sunken hover:text-ink"
        >
          <span aria-hidden className="text-base leading-none">
            ✉
          </span>
          {name.split(" ")[0]} schreiben
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOffen(true)}
          aria-label={`${name} etwas schreiben`}
          title="Etwas schreiben"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-soft transition hover:bg-sunken hover:text-navy-700"
        >
          <span aria-hidden className="text-base leading-none">
            ✉
          </span>
        </button>
      )}

      <Modal
        open={offen}
        onClose={() => setOffen(false)}
        title="Kurz was sagen"
        subtitle={name}
      >
        {gesendet ? (
          <p className="py-6 text-center text-sm font-semibold text-emerald-700">
            Ist raus.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              {schnelltexte.map((text) => (
                <button
                  key={text}
                  type="button"
                  disabled={pending}
                  onClick={() => senden(text)}
                  className="flex min-h-14 w-full items-center rounded-full bg-sunken px-4 text-sm font-semibold text-ink-muted transition hover:bg-akzent hover:text-white disabled:opacity-50"
                >
                  {text}
                </button>
              ))}
            </div>

            <div className="border-t border-line pt-4">
              <input
                type="text"
                value={eigener}
                maxLength={NACHRICHT_MAX_ZEICHEN}
                onChange={(event) => setEigener(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    senden(eigener);
                  }
                }}
                placeholder="Oder selbst schreiben …"
                className={inputBlank}
              />
              <button
                type="button"
                disabled={pending || eigener.trim().length === 0}
                onClick={() => senden(eigener)}
                className={`${btnPrimary} mt-2 w-full disabled:opacity-40`}
              >
                Senden
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
