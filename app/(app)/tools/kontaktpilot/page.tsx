import ContactPilot from "@/components/pilots/ContactPilot";
import { requireUser } from "@/lib/auth";

export default async function ContactPilotPage() {
  const user = await requireUser();
  return <div className="crm-work-tools-page"><header><h1>Freiwilliger Kontaktpilot</h1><p>Kontaktarbeit vorbereiten, passende Tage wählen und anhand ausdrücklicher Bestätigungen lernen.</p></header><ContactPilot key={user.id} /></div>;
}
