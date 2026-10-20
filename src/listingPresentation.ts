const stateNames = "AL:Alabama|AK:Alaska|AZ:Arizona|AR:Arkansas|CA:California|CO:Colorado|CT:Connecticut|DE:Delaware|DC:District of Columbia|FL:Florida|GA:Georgia|HI:Hawaii|ID:Idaho|IL:Illinois|IN:Indiana|IA:Iowa|KS:Kansas|KY:Kentucky|LA:Louisiana|ME:Maine|MD:Maryland|MA:Massachusetts|MI:Michigan|MN:Minnesota|MS:Mississippi|MO:Missouri|MT:Montana|NE:Nebraska|NV:Nevada|NH:New Hampshire|NJ:New Jersey|NM:New Mexico|NY:New York|NC:North Carolina|ND:North Dakota|OH:Ohio|OK:Oklahoma|OR:Oregon|PA:Pennsylvania|RI:Rhode Island|SC:South Carolina|SD:South Dakota|TN:Tennessee|TX:Texas|UT:Utah|VT:Vermont|VA:Virginia|WA:Washington|WV:West Virginia|WI:Wisconsin|WY:Wyoming";
const states = new Map(stateNames.split("|").flatMap((entry) => {
  const [code, name] = entry.split(":");
  return [[code.toLowerCase(), code], [name.toLowerCase(), code]];
}));
const normalized = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
export const listingStateCode = (value: string): string | null => states.get(normalized(value)) ?? null;
function place(value: string) {
  const parts = value.replace(/^(?:(?:business\s+)?location\s*:?\s*)+/i, "").split(",").map(normalized);
  if (parts.length !== 2 || !parts[0] || !states.has(parts[1])) return null;
  const kind = /\bcounty$|^county of\b/.test(parts[0]) ? "county" : /^city of\b|\bcity$/.test(parts[0]) ? "city" : "unspecified";
  const name = parts[0].replace(/^(?:city|county) of\s+/, "").replace(/\s+(?:county|city)$/, "");
  return { name, kind, state: states.get(parts[1])! };
}

export function equivalentListingLocations(source: string, structured: string, context: { city?: string | null; state?: string | null }): boolean {
  if (normalized(source) === normalized(structured)) return true;
  const left = place(source), right = place(structured);
  if (!left || !right || left.state !== right.state || left.name !== right.name) return false;
  if (left.kind === right.kind) return true;
  // The source must explicitly identify the county, and the provider must repeat
  // that same bare locality and state. Do not infer city/county relationships.
  return left.kind === "county" && right.kind === "unspecified" &&
    normalized(context.city ?? "") === left.name && states.get(normalized(context.state ?? "")) === left.state;
}

/** Whitespace-only repairs for recognizable scraped boundaries; retain every claim verbatim. */
export function formatScrapedDescription(value: string): string {
  return value
    .replace(/\bHIGHLIGHTS[ \t]*(?=[A-Z])/g, "HIGHLIGHTS\n")
    .replace(/\bEstablished(?=(?:19|20)\d{2})/g, "Established ")
    .replace(/\b(Established\s+(?:19|20)\d{2})[ \t]*(?=\d{1,3}%)/g, "$1\n")
    .replace(/(Revenue\s+Mix)[ \t]*(?=Owner[- ]Operated\b)/g, "$1\n")
    .replace(/(Hours\/Week)[ \t]*(?=Exclusive\b)/g, "$1\n")
    .replace(/(Franchise\s+Territory)[ \t]*(?=This\b)/g, "$1\n\n")
    .replace(/([a-z0-9][.!?])[ \t]*(?=[A-Z][a-z])/g, "$1\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
