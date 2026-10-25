import type { ComponentProps } from "react";

/**
 * Personenakten öffnen als Dokumentnavigation. Im Produktionsbuild von Next 15
 * kann der RSC-Übergang nach erfolgreicher Antwort hängen bleiben. Der normale
 * Link erhält Tastatur, Touch und Öffnen in einem neuen Tab ohne diesen Zustand.
 */
export default function PersonLink(props: ComponentProps<"a">) {
  return <a {...props} />;
}
