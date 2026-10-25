/** Eine dauerhafte Namensfreigabe umfasst auch die Pipelinekennzahlen. */
export function pipelineFreigegeben(visibility: string): boolean {
  return visibility === "PIPELINE" || visibility === "NAMEN";
}
