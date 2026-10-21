import type { AssetDetail, RatioSnapshot, RealEstateDetail } from "./types";

// Keep magnitude suffixes attached when extracting currency from surrounding text.
export const MONEY_TOKEN_PATTERN = String.raw`\$?\s*-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s*(?:million|thousand|[mk])\b)?`;

export function roundedMoneyMatches(raw: string | null, exact: number): boolean {
  if (!raw) return false;
  const match = raw.trim().match(/^\$?\s*(\d+(?:\.\d+)?)\s*(million|thousand|m|k)$/i);
  if (!match) return false;
  const magnitude = /^(m|million)$/i.test(match[2]) ? 1_000_000 : 1_000;
  const decimals = match[1].split(".")[1]?.length ?? 0;
  const tolerance = magnitude / 10 ** decimals / 2;
  return Math.abs(Number(match[1]) * magnitude - exact) <= tolerance + Number.EPSILON * magnitude;
}

export function parseMoney(input: string | null | undefined): number | null {
  if (!input) {
    return null;
  }

  const text = input.trim().toLowerCase();

  if (!text || text.replace(/\s+/g, "") === "notdisclosed" || /\b(n\/a|not applicable)\b/i.test(text)) {
    return null;
  }

  if (/\b(ad\s*#|ad number|employees?|building sf|sq\.?\s*ft|square feet)\b/i.test(text)) {
    return null;
  }

  const match = text.match(/(?<dollar>\$)?\s*(?<number>-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?)\s*(?<suffix>k|m|million|thousand)?\b/i);
  if (!match) {
    return null;
  }

  const numberText = match.groups?.number ?? "";
  const suffix = match.groups?.suffix;
  const hasMoneySignal = Boolean(match.groups?.dollar || suffix || numberText.includes(","));
  if (!hasMoneySignal) {
    return null;
  }

  const amount = Number(numberText.replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  if (suffix === "k" || suffix === "thousand") {
    return amount * 1_000;
  }
  if (suffix === "m" || suffix === "million") {
    return amount * 1_000_000;
  }
  return amount;
}

export function formatMoney(amount: number | null): string {
  if (amount === null) {
    return "Not Disclosed";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(amount);
}

export function safeRatio(numerator: number | null, denominator: number | null, precision = 2): number | null {
  if (numerator === null || denominator === null || denominator <= 0) {
    return null;
  }

  return Number((numerator / denominator).toFixed(precision));
}

export function calculateRatios(values: {
  askingPrice: number | null;
  businessAskingPrice?: number | null;
  sde: number | null;
  ebitda: number | null;
  annualRevenue: number | null;
}): RatioSnapshot {
  return {
    askingPriceToSde: safeRatio(values.askingPrice, values.sde),
    businessAskingPriceToSde: safeRatio(values.businessAskingPrice ?? null, values.sde),
    askingPriceToEbitda: safeRatio(values.askingPrice, values.ebitda),
    sdeToRevenue: safeRatio(values.sde, values.annualRevenue, 4)
  };
}

export function calculateKnownAdditionalCosts(values: {
  inventory: AssetDetail;
  ffe: AssetDetail;
  realEstate: RealEstateDetail;
}): number | null {
  const costs = [values.inventory, values.ffe, values.realEstate]
    .filter((asset) => asset.includedStatus === "not_included")
    .filter((asset) => asset !== values.realEstate || !isOptionalRealEstate(values.realEstate))
    .map((asset) => asset.value.amount)
    .filter((amount): amount is number => typeof amount === "number" && Number.isFinite(amount));

  if (costs.length === 0) {
    return null;
  }

  return costs.reduce((total, amount) => total + amount, 0);
}

export function isOptionalRealEstate(realEstate: RealEstateDetail): boolean {
  const text = [realEstate.value.raw, realEstate.notes.value].filter(Boolean).join(" ");
  if (/\b(required|must be purchased|must purchase|part of the required transaction|required acquisition)\b/i.test(text)) {
    return false;
  }
  return (
    realEstate.includedStatus === "not_included" ||
    /\b(separate|separately|offered separately|sold separately|available separately|optional|not included|excluded)\b/i.test(text)
  );
}

export function formatRatio(value: number | null, suffix = "x"): string {
  if (value === null) {
    return "Not Disclosed";
  }

  return `${value.toFixed(2)}${suffix}`;
}
