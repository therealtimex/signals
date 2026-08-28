import { z } from "zod";

export const orgTypeSchema = z.enum(["company", "fund", "team", "community", "other"]);
export const companySizeSchema = z.enum([
  "1-10",
  "11-50",
  "51-200",
  "201-500",
  "501-1000",
  "1001-5000",
  "5001-10000",
  "10001+",
]);
export const accountStageSchema = z.enum([
  "prospect",
  "engaged",
  "qualified",
  "opportunity",
  "customer",
  "advocate",
]);

const nullableText = z.string().trim().max(10_000).nullable();
const nullableHttpUrl = z
  .string()
  .trim()
  .url()
  .refine((value) => value.startsWith("http://") || value.startsWith("https://"), {
    message: "Use an http(s) URL",
  })
  .nullable();

export const orgUpdateFieldsSchema = z.object({
  name: z.string().trim().min(1).max(240).optional(),
  orgType: orgTypeSchema.optional(),
  domain: z.string().trim().max(255).nullable().optional(),
  website: z.string().trim().max(2_048).nullable().optional(),
  description: nullableText.optional(),
  location: z.string().trim().max(500).nullable().optional(),
  avatarUrl: nullableHttpUrl.optional(),
  industry: z.string().trim().max(500).nullable().optional(),
  companySize: companySizeSchema.nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  ownerContactId: z.string().min(1).nullable().optional(),
  accountStage: accountStageSchema.nullable().optional(),
});

export const orgPatchSchema = orgUpdateFieldsSchema.extend({
  updatedVia: z.literal("manual").optional(),
});
