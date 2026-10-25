/** The provider receives the supported schema subset; Zod validates full limits. */
const keys = new Set(["type", "properties", "required", "additionalProperties", "enum", "anyOf", "items"]);
export function providerSchema(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => keys.has(key)).map(([key, item]) => {
    if (key === "properties") return [key, Object.fromEntries(Object.entries(item as Record<string, Record<string, unknown>>).map(([name, field]) => [name, providerSchema(field)]))];
    if (key === "anyOf") return [key, (item as Record<string, unknown>[]).map(providerSchema)];
    if (key === "items" && item && typeof item === "object") return [key, providerSchema(item as Record<string, unknown>)];
    return [key, item];
  }));
}
