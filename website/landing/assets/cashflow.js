export function calculateCashFlow(values) {
  const baselineKeys = ['starting', 'debt', 'owner', 'capex', 'working'];
  const improvementKeys = ['payroll', 'savings', 'costs'];
  const number = key => {
    const value = String(values[key] ?? '').trim();
    if (!/^-?(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(value)) return null;
    const amount = Number(value);
    if (!Number.isFinite(amount) || Math.abs(amount) > 1e12 || (key !== 'starting' && amount < 0)) return null;
    return Math.round(amount * 100);
  };
  const baseline = baselineKeys.map(number);
  const improvement = improvementKeys.map(number);
  const annualCents = baseline.includes(null) ? null : baseline[0] - baseline.slice(1).reduce((sum, value) => sum + value, 0);
  const differenceCents = improvement.includes(null) ? null : improvement[0] + improvement[1] - improvement[2];
  const improvedCents = annualCents === null || differenceCents === null ? null : annualCents + differenceCents;
  const implementation = number('implementation');
  const dollars = value => value === null ? null : value / 100;
  const monthly = value => value === null ? null : Math.round(value / 12) / 100;
  return {
    annual: dollars(annualCents), monthly: monthly(annualCents),
    improved: dollars(improvedCents), improvedMonthly: monthly(improvedCents),
    difference: dollars(differenceCents),
    firstYear: improvedCents === null || implementation === null ? null : dollars(improvedCents - implementation),
    invalid: [...baselineKeys, ...improvementKeys, 'implementation'].filter(key => String(values[key] ?? '').trim() !== '' && number(key) === null)
  };
}

export const money = value => value === null ? 'Incomplete' : new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2
}).format(value);
