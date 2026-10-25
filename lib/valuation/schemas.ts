import { z } from "zod";

const num = z.number().finite();
const bridgeItem = z.object({ label: z.string().trim().min(1).max(120), amount: num });

export const comparableSchema = z.object({
  name: z.string().trim().min(1).max(120), industry: z.string().max(120).optional(),
  revenue: num.nullable(), ebitda: num.nullable(), enterpriseValue: num.nullable(), equityValue: num.nullable().optional(), netDebt: num.nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/), reportingDate: z.string().max(20).optional(), source: z.string().trim().min(2, "Each comparable needs a source").max(300),
  notes: z.string().max(1000).optional(), included: z.boolean(), exclusionReason: z.string().max(300).optional(),
});

export const comparablesInputSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/), multiple: z.enum(["ev_ebitda", "ev_revenue"]), targetMetricValue: num.nullable(),
  targetMetricLabel: z.string().max(80), netDebt: num.nullable(), otherBridgeItems: z.array(bridgeItem).max(20),
  baseMultipleOverride: num.nullable().optional(), overrideJustification: z.string().max(1000).optional(),
  comparables: z.array(comparableSchema).min(1).max(50),
});

const perYear = z.array(num).min(1).max(15);
export const dcfInputSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/), baseYearLabel: z.string().max(20), baseRevenue: num, baseNetWorkingCapital: num,
  years: z.number().int().min(1).max(15), revenueGrowth: perYear, ebitdaMargin: perYear, daPctRevenue: perYear, capexPctRevenue: perYear,
  nwcPctRevenue: perYear, taxRate: num, wacc: num, terminalGrowth: num, midYear: z.boolean(), netDebt: num.nullable(), otherBridgeItems: z.array(bridgeItem).max(20),
});

export const saveSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("comparables"), submissionId: z.string().uuid(), modelName: z.string().trim().min(2).max(120), comments: z.string().max(2000).optional(), input: comparablesInputSchema }),
  z.object({ method: z.literal("dcf"), submissionId: z.string().uuid(), modelName: z.string().trim().min(2).max(120), comments: z.string().max(2000).optional(), input: dcfInputSchema }),
]);
export type SavePayload = z.infer<typeof saveSchema>;
