import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { warumSpeichern } from "../actions";
import { columnNarrow, pageTitle, input, btnPrimary } from "@/components/ui";

export default async function WarumPage() {
  const user = await requireUser();
  return (
    <div className={`${columnNarrow} space-y-7`}>
      <Link href="/fortschritt" className="inline-flex min-h-12 items-center">
        ← Fortschritt
      </Link>
      <h1 className={pageTitle}>Mein Warum</h1>
      <p className="text-base text-slate-600">
        Was möchtest du dir durch deine Arbeit ermöglichen? Diese Zeilen gehören
        dir.
      </p>
      <form action={warumSpeichern} className="space-y-5">
        <label className="block text-base">
          Dein persönlicher Grund
          <textarea
            className={input}
            name="warum"
            rows={8}
            maxLength={4000}
            defaultValue={user.whyLetter ?? ""}
          />
        </label>
        <button className={`${btnPrimary} min-h-14`}>Speichern</button>
      </form>
    </div>
  );
}
