const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);

// Curated presentation data only. Full listing records and modeling stay in the scanner.
export const previews = {
  painting: {
    id: 'KH-025', name: 'Painting Co. Franchise Resale', recommendation: 'Investigate',
    location: 'Mecklenburg County, NC', industry: 'Painting and finishing services', model: 'Mobile franchise',
    asking: 137500, revenue: 352757, cashFlow: 66392, sde: null, business: 137500, realEstate: null,
    photo: 'photos/painting-portrait-960.webp', photoAlt: 'Painter finishing an interior wall; representative photography',
    photoSrcset: 'assets/photos/painting-portrait-480.webp 480w, assets/photos/painting-portrait-960.webp 960w, assets/photos/painting-portrait-1440.webp 1440w',
    photoWidth: 960, photoHeight: 1440,
    context: 'Owner dependence and franchise requirements deserve closer attention.',
    positive: 'A mobile operating model with an established service territory, subject to verification.',
    consideration: 'Owner-led sales and scheduling need a viable transition; franchise transfer terms are not established.',
    questions: [
      ['Who carries the owner’s responsibilities forward?', 'Verify sales, scheduling, customer communication, and transition support. Do not assume replacement compensation or existing staff coverage.'],
      ['What franchise terms apply to a transfer?', 'Confirm approval, applicable fees, and operating requirements. No undisclosed restrictions or amounts are assumed.'],
      ['What supports the advertised cash flow?', 'Reconcile the seller-reported figure with source financials. Its accounting basis is unverified; EBITDA is not disclosed.']
    ]
  },
  manufacturing: {
    id: 'KH-026', name: 'Specialty Manufacturing & Real Estate', recommendation: 'Keep Reading',
    location: 'Central North Carolina', industry: 'Industrial equipment accessories', model: 'Specialty manufacturing + owned facility',
    asking: 1240000, revenue: 775132, cashFlow: 227261, sde: 227261, business: 565000, realEstate: 675000,
    photo: 'photos/manufacturing-worker-960.webp', photoAlt: 'Factory worker operating industrial equipment; representative photography',
    photoSrcset: 'assets/photos/manufacturing-worker-480.webp 480w, assets/photos/manufacturing-worker-960.webp 960w, assets/photos/manufacturing-worker-1440.webp 1440w',
    photoWidth: 960, photoHeight: 639,
    context: 'Included equipment, owned real estate, and management continuity shape the transaction.',
    positive: 'Specialized products with operating assets and real estate included in the advertised transaction.',
    consideration: 'Included assets still require condition, lien, and property diligence; management responsibilities remain undisclosed.',
    questions: [
      ['Can the included equipment sustain operations?', 'Verify condition, maintenance history, liens, and remaining useful life. Inclusion does not verify equipment continuity.'],
      ['What exactly transfers in the combined price?', 'Confirm the $565,000 business and $675,000 included real estate components. Inventory and FF&E are included, with individual values undisclosed.'],
      ['Who manages the business after closing?', 'Establish owner duties, key-person dependencies, and transition support. No management cost or shared staffing is assumed.']
    ]
  }
};

export function snapshotFor(key) {
  if (!Object.hasOwn(previews, key)) return null;
  const deal = previews[key];
  if (!deal) return null;
  const explicitSde = deal.sde !== null;
  const earnings = explicitSde ? deal.sde : deal.cashFlow;
  return {
    asking: money(deal.asking), revenue: money(deal.revenue), earnings: money(earnings),
    askingLabel: deal.realEstate === null ? 'Asking price' : 'Combined asking price',
    earningsLabel: explicitSde ? 'Advertised SDE' : 'Advertised cash flow',
    ratioLabel: explicitSde ? 'Business-only price / SDE' : 'Asking / advertised cash flow',
    ratio: `${((explicitSde ? deal.business : deal.asking) / earnings).toFixed(2)}×`,
    note: explicitSde ? 'Seller-reported SDE, not verified earnings. EBITDA is not disclosed.' : 'Advertised cash flow is not verified SDE. EBITDA is not disclosed.'
  };
}
