import type { DealScan } from "./types";
import type { CashFlowAssumptions } from "./acquisitionCashFlow";

export type AcquisitionForm = {
  streetAddress?: string;
  businessWebsite?: string;
  businessName: string; listingUrl: string; listingText: string; askingPrice: string;
  businessAskingPrice: string; annualRevenue: string; sde: string; ebitda: string;
  advertisedCashFlow: string; inventory: string; ffe: string; realEstate: string;
};

export type AcquisitionState = { scan: DealScan | null; form: AcquisitionForm; cashFlow: CashFlowAssumptions };
export type AcquisitionRecord = {
  schemaVersion: 1; id: string; name: string; createdAt: string; updatedAt: string; revision: number;
  origin: "local" | "imported" | "legacy";
  state: AcquisitionState & { scan: DealScan };
};
export type RecoveryDraft = { recordId: string | null; recordRevision: number | null; state: AcquisitionState };
