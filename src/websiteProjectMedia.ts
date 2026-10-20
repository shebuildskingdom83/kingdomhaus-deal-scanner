import type { DealScan, WebsiteProjectPhotograph } from "./types";

export const WEBSITE_PROJECT_ATTRIBUTION = "DiCostanzo Welding Services website project photograph; third-party rights retained.";
const website = "https://www.dicostanzowelding.com";
// Explicitly reviewed first-party Wix assets from the authorized one-time recovery.
const approvedAssets = new Set([
  "a0dd22_ae14696d834f4938973e3bf28c49ed07~mv2.jpeg",
  "a0dd22_99642dd7c22f4da1a6edf8f26f42697a~mv2.jpeg",
  "a0dd22_3466dc8521cd430cb660f5d127c99e67~mv2.jpeg",
  "a0dd22_ed7413e06945454193d6f4ce4dce193d~mv2.jpeg"
]);

export function approvedWebsiteProjectPhoto(photo: WebsiteProjectPhotograph): boolean {
  try {
    const source = new URL(photo.sourceUrl), image = new URL(photo.url);
    return photo.sourceType === "seller_website" && photo.attribution === WEBSITE_PROJECT_ATTRIBUTION &&
      source.origin === website && !source.username && !source.password && !source.search && !source.hash &&
      ["/", "/projects", "/projects/"].includes(source.pathname) &&
      image.origin === "https://static.wixstatic.com" && !image.username && !image.password && !image.search && !image.hash &&
      approvedAssets.has(image.pathname.split("/")[2]) && image.pathname.startsWith("/media/");
  } catch { return false; }
}

export function websiteProjectsBelongToScan(scan: DealScan): boolean {
  try {
    const listing = new URL(scan.listingUrl ?? "");
    const seller = new URL(scan.businessDetails.businessWebsite?.value ?? "");
    return listing.protocol === "https:" && !listing.username && !listing.password && !listing.port &&
      ["www.bizbuysell.com", "bizbuysell.com"].includes(listing.hostname) &&
      /^\/business-opportunity\/[^/]+\/2558952\/?$/.test(listing.pathname) &&
      seller.origin === website && !seller.username && !seller.password;
  } catch { return false; }
}

export function websiteProjectPhotographs(scan: DealScan): WebsiteProjectPhotograph[] {
  return websiteProjectsBelongToScan(scan) ? (scan.websiteProjectPhotographs ?? []).filter(approvedWebsiteProjectPhoto).slice(0, 10) : [];
}
