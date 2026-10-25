"use client";

// Die Unterebene des Wettbewerbs.
//
// In der Hauptnavigation steht ein einziger Punkt ("Wettbewerb"). Was darunter
// zusammengehoert, verlinkt sich hier: die Arena als Ort des Geschehens, die
// Rangliste als Tabelle, die eigenen Aktivitaeten zum Nachtragen, und das
// Spiel als das, was man sich damit aufmacht. Vier Seiten, eine Sache - das
// gehoert eine Ebene tiefer und nicht in die Kopfzeile.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn, segmentGruppe, segmentKnopf } from "@/components/ui";

const PUNKTE = [
  { href: "/arena", label: "Arena" },
  { href: "/leaderboard", label: "Rangliste" },
  { href: "/log", label: "Meine Aktivitäten" },
  { href: "/spiel", label: "Spiel" },
];

export default function WettbewerbNav() {
  const pathname = usePathname();

  return (
    <div className={cn(segmentGruppe, "no-scrollbar w-full overflow-x-auto")}>
      {PUNKTE.map((punkt) => {
        const aktiv = pathname === punkt.href;
        return (
          <Link
            key={punkt.href}
            href={punkt.href}
            aria-current={aktiv ? "page" : undefined}
            className={cn(segmentKnopf(aktiv), "flex-1 shrink-0 whitespace-nowrap")}
          >
            {punkt.label}
          </Link>
        );
      })}
    </div>
  );
}
