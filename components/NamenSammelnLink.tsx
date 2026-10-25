"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { SparkIcon } from "@/components/icons";
import { useAssistant } from "@/components/ai-crm/AssistantProvider";
import { NAMEN_SAMMELN, navigationHref } from "@/lib/navigation";
import { useWorkspaceNavigation } from "@/components/WorkspaceNavigation";

export default function NamenSammelnLink({ className }: { className: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const { defaultList } = useWorkspaceNavigation();
  const assistant = useAssistant();
  if (pathname === "/namen/sammeln" && !assistant.visible) return null;

  return (
    <Link
      href={navigationHref(NAMEN_SAMMELN, pathname, params, defaultList)}
      prefetch={false}
      onClick={assistant.close}
      className={`crm-collection-action ${className}`}
    >
      <SparkIcon className="h-5 w-5 shrink-0" />
      Namen sammeln
    </Link>
  );
}
