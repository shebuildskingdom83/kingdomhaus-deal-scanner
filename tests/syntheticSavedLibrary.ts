import { formFromScan, makeRecord } from "../src/storage";
import { createCashFlowAssumptions } from "../src/acquisitionCashFlow";
import { buildLocalPreviewScan } from "../src/validation";

export function syntheticLibrary(count = 53) {
  const scan = buildLocalPreviewScan({ listingText: "Fictional business for interface testing. Asking Price: $123000. Gross Revenue: $234000." });
  const base = makeRecord({ scan, form: formFromScan(scan), cashFlow: createCashFlowAssumptions() });
  return Array.from({ length: count }, (_, i) => {
    const id = `synthetic-library-${i + 1}`;
    return { ...structuredClone(base), id, name: `Example ${i % 2 ? "Metal Works" : "Service Group"} ${String(i + 1).padStart(2, "0")}`,
      createdAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
      updatedAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
      state: { ...structuredClone(base.state), scan: { ...structuredClone(base.state.scan), id } } };
  });
}
