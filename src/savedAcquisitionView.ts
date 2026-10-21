import type { AcquisitionRecord } from "./acquisitionRecord";

export const SAVED_ACQUISITIONS_PAGE_SIZE = 10;

export function savedAcquisitionView(records: readonly AcquisitionRecord[], query: string, requestedPage: number) {
  const term = query.trim().toLowerCase();
  const matches = records.filter(record => record.name.toLowerCase().includes(term))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const total = matches.length;
  const totalPages = Math.max(1, Math.ceil(total / SAVED_ACQUISITIONS_PAGE_SIZE));
  const page = Math.min(totalPages, Math.max(1, Math.trunc(requestedPage) || 1));
  const offset = (page - 1) * SAVED_ACQUISITIONS_PAGE_SIZE;
  return { records: matches.slice(offset, offset + SAVED_ACQUISITIONS_PAGE_SIZE), total, totalPages, page,
    start: total ? offset + 1 : 0, end: Math.min(offset + SAVED_ACQUISITIONS_PAGE_SIZE, total) };
}
