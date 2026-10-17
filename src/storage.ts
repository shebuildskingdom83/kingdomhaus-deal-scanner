import type { DealScan } from "./types";

const storageKey = "kingdomhaus-deal-scans:v1";

export function loadSavedScans(): DealScan[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 20) : [];
  } catch {
    return [];
  }
}

export function saveScan(scan: DealScan): DealScan[] {
  const existing = loadSavedScans();
  const next = [scan, ...existing.filter((item) => item.id !== scan.id)].slice(0, 20);
  localStorage.setItem(storageKey, JSON.stringify(next));
  return next;
}
