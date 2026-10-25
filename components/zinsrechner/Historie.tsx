import { HISTORIE, HISTORIE_QUELLE, prozent } from "@/lib/zinsrechner";
import styles from "./zinsrechner.module.css";

export default function Historie() {
  return (
    <details className={styles.panel}>
      <summary className={styles.summary}>Und wenn die Kurse fallen?</summary>
      <p className={styles.muted}>
        Einzelne Jahre können deutlich im Minus liegen. Hier siehst du die
        abgeschlossenen Jahre 2012–2025 des MSCI World. Die glatte Kurve im
        Rechner ist eine Modellannahme; echte Kurse schwanken.
      </p>
      <div
        className={styles.history}
        role="list"
        aria-label="MSCI World Jahresrenditen 2012 bis 2025"
      >
        {HISTORIE.map(([year, rate]) => (
          <div role="listitem" key={year} className={styles.historyRow}>
            <span>{year}</span>
            <div className={styles.historyTrack}>
              <span
                style={{
                  width: `${(Math.abs(rate) / 30) * 50}%`,
                  left:
                    rate < 0 ? `${50 - (Math.abs(rate) / 30) * 50}%` : "50%",
                  background:
                    rate < 0
                      ? "var(--color-fest-gefahr)"
                      : "var(--color-akzent)",
                }}
              />
            </div>
            <strong>
              {rate > 0 ? "+" : ""}
              {prozent(rate)}
            </strong>
          </div>
        ))}
      </div>
      <p className={styles.small}>
        Nettoindexrenditen in US-Dollar, nominal. Keine Euro-Anlegerrendite;
        persönliche Steuern und Produktkosten sind nicht abgezogen. Frühere
        Ergebnisse garantieren keine zukünftigen Ergebnisse.
      </p>
      <a
        className={styles.textLink}
        href={HISTORIE_QUELLE}
        target="_blank"
        rel="noopener noreferrer"
      >
        Quelle: MSCI World Factsheet · Stand 31.08.2026 ↗
      </a>
    </details>
  );
}
