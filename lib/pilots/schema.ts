import { z } from "zod";
export const suitableDaysSchema = z.tuple([z.array(z.string().length(10)).min(2).max(7), z.array(z.string().length(10)).min(2).max(7)]);
