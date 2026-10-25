import { z } from "zod";

export const assistantContextSchema = z.object({
  contactId: z.string().min(1).max(120).optional(),
  partnerId: z.string().min(1).max(120).optional(),
  followUpId: z.string().min(1).max(120).optional(),
  entityType: z.enum(["note", "task", "agreement", "appointment"]).optional(),
  entityId: z.string().min(1).max(120).optional(),
}).strict().refine(value => Boolean(value.contactId) !== Boolean(value.partnerId) || !value.contactId && !value.partnerId && value.entityType === "appointment" && Boolean(value.entityId), "Wähle genau einen Personenbezug oder einen eigenen Termin.")
  .refine(value => !value.followUpId || Boolean(value.contactId))
  .refine(value => Boolean(value.entityType) === Boolean(value.entityId));
