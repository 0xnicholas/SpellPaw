// Single source of truth for the contact non-PII projection (spec §3 PII
// contract). Both the REST contacts routes and the MCP contact tools must use
// this — never add profile_* columns here.
import type { Prisma } from "@/generated/prisma/client";

export const NON_PII_SELECT = {
  id: true,
  type: true,
  personaContentDNA: true,
  personaSentimentArc: true,
  personaIntentVector: true,
  stateLifecycleStage: true,
  stateRiskScore: true,
  stateOpportunityScore: true,
  lastInteractionAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ContactSelect;
