export default function Loading() {
  return <div className="crm-contact-load-state" role="status" aria-live="polite"><p className="text-sm text-ink-muted">Kontakte werden geladen …</p><div className="crm-contact-rows" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <div key={index} className="crm-contact-skeleton" />)}</div></div>;
}
