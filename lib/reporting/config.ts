import { z } from "zod";

export const REPORT_SECTIONS = [
  ["executive_summary", "Executive summary"], ["scope_methodology", "Scope and methodology"], ["overview", "Company and submission overview"],
  ["data_quality", "Data availability and quality"], ["revenue", "Revenue analysis"], ["profitability", "Profitability analysis"],
  ["ebitda", "EBITDA analysis"], ["working_capital", "Working capital analysis"], ["debt_cash_flow", "Debt and cash flow analysis"],
  ["findings", "Key findings"], ["valuation", "Valuation analysis"], ["limitations", "Risks and limitations"], ["appendix", "Appendices"],
] as const;
export type SectionKey = (typeof REPORT_SECTIONS)[number][0];

export const reportConfigSchema = z.object({
  sections: z.array(z.enum(REPORT_SECTIONS.map(([k]) => k) as [SectionKey, ...SectionKey[]])).min(1, "Select at least one section"),
  executive_summary: z.string().max(6000).default(""),
  limitations: z.string().max(3000).default(""),
});
export type ReportConfig = z.infer<typeof reportConfigSchema>;
