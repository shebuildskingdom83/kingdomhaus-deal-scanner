import { syntheticLibrary } from "./syntheticSavedLibrary";
import { buildLocalPreviewScan } from "../src/validation";
import { formFromScan } from "../src/storage";
import { createCashFlowAssumptions } from "../src/acquisitionCashFlow";

export function migrationFixtures() {
  return syntheticLibrary(4).map((record, index) => {
    const id = "synthetic-migration-" + (index + 1);
    const sourceUrl = `https://www.bizbuysell.com/business-opportunity/fictional-migration-${index + 1}/99008${index + 1}0/`;
    const scan = buildLocalPreviewScan({ listingUrl: sourceUrl,
      listingText: `Fictional migration workshop ${index + 1}.\nAsking Price: $287000\nGross Revenue: $631000\nCash Flow: $92000\nEBITDA: $71000\nIndustry: Synthetic fabrication\nLocation: Example City, NC\nEmployees: 3\nBroker Name: Morgan Fictional\nFacilities: Fictional leased workshop.\nGrowth & Expansion: Synthetic training services.\nReason for Selling: Fictional relocation.`,
      corrections: { businessName: "Fictional Migration Workshop " + (index + 1), sde: "94000", streetAddress: "123 Imaginary Lane, Example City, NC 27000", businessWebsite: "https://fictional-migration.example/" } });
    scan.id = id;
    scan.createdAt = "2025-03-01T12:00:00.000Z";
    scan.retrieval = { provider: "apify", actorId: "synthetic-actor", retrievedAt: scan.createdAt, sourceUrl,
      usageUsd: null, maxChargeUsd: 0.25, rawRecord: {}, conflicts: [], photographs: [{
        url: `https://images.bizbuysell.com/synthetic-migration/workshop-${index + 1}.jpg`, sourceUrl,
        alt: "Fabricated regression image reference", caption: "Synthetic workshop only", attribution: "Synthetic source reference; no real photograph retrieved"
      }] };
    return { ...record, id, name: "Fictional Migration Workshop " + (index + 1), revision: [1, 4, 9, 23][index],
      state: { scan, form: formFromScan(scan), cashFlow: { ...createCashFlowAssumptions(), startingMetric: "sde" as const,
        debtService: "14000", managementCosts: "22000", normalizationAdjustment: "0", capexReserve: "4000", workingCapitalReserve: "2500",
        payrollSavings: "3300", operatingSavings: "1200", improvementCosts: "900", implementationCosts: "1700",
        normalizationNotes: "Fictional assumptions for migration tests only.", currentReviewed: true, improvementsReviewed: true } } };
  });
}
