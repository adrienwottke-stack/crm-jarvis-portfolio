import MemoryManager from "@/components/memory/MemoryManager";
import { requireUser } from "@/lib/auth";

export default async function MemoryPage() {
  const user = await requireUser();
  return <div className="crm-work-tools-page">
    <header className="crm-page-heading"><h1>Jarvis-Erinnerung</h1><p>Hier bestimmst du ausdrücklich, was Jarvis längerfristig berücksichtigen darf.</p></header>
    <MemoryManager key={user.id} />
  </div>;
}
