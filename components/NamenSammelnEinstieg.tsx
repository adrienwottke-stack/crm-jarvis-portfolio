"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startFortsetzen } from "@/app/startActions";
import { SparkIcon } from "@/components/icons";
import { card } from "@/components/ui";

export default function NamenSammelnEinstieg({ fortsetzen }: { fortsetzen: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);
  const label = <><SparkIcon className="h-5 w-5" />Jetzt Namen sammeln</>;

  return (
    <section aria-labelledby="namen-sammeln-einstieg" className={`${card} space-y-3 p-5 sm:p-6`}>
      <h2 id="namen-sammeln-einstieg" className="text-2xl font-semibold text-ink">Namen sammeln</h2>
      <p className="text-ink-muted">
        Wen kennst du noch? Die Gedächtnisstützen helfen dir, weitere Namen zu finden.
      </p>
      {fortsetzen ? (
        <button
          type="button"
          disabled={pending}
          className="crm-primary-action w-full disabled:opacity-60"
          onClick={() => startTransition(async () => {
            setError(false);
            try {
              router.push(await startFortsetzen());
            } catch {
              setError(true);
            }
          })}
        >
          {pending ? "Stand laden …" : label}
        </button>
      ) : (
        <Link href="/namen/sammeln" prefetch={false} className="crm-primary-action">
          {label}
        </Link>
      )}
      {error && <p role="alert" className="text-sm text-red-700">Der Stand konnte nicht geladen werden. Bitte erneut versuchen.</p>}
    </section>
  );
}
