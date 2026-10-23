import { calculateCashFlow } from './cashflow.js';

export const paintingTeaserAssumptions = Object.freeze({
  starting: '66392', debt: '15000', capex: '5000', working: '3000'
});

// Fixed sample assumptions; the full scanner also requires normalization and overlap review.
export function paintingCashRemaining(owner) {
  const value = String(owner).trim();
  if (!/^(?:\d+(?:\.\d{1,2})?)$/.test(value)) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 50000) return null;
  return calculateCashFlow({ ...paintingTeaserAssumptions, owner: value }).annual;
}
