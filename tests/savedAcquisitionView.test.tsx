import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { savedAcquisitionView } from "../src/savedAcquisitionView";
import { AcquisitionRecovery } from "../src/AcquisitionRecovery";
import type { useAcquisitionRecovery } from "../src/useAcquisitionRecovery";
import { AcquisitionRepository, parseBackup, serializeBackup } from "../src/storage";
import { syntheticLibrary } from "./syntheticSavedLibrary";

describe("Saved scans search and pagination", () => {
  it("paginates 53 records by descending update time without altering records", () => {
    const records = syntheticLibrary();
    const before = JSON.stringify(records);
    const ids: string[] = [];
    for (let page = 1; page <= 6; page++) {
      const view = savedAcquisitionView(records, "", page);
      expect(view.records).toHaveLength(page === 6 ? 3 : 10);
      expect(view.totalPages).toBe(6);
      expect(view.start).toBe((page - 1) * 10 + 1);
      expect(view.end).toBe(Math.min(page * 10, 53));
      ids.push(...view.records.map(r => r.id));
    }
    expect(ids).toEqual(records.map(r => r.id).reverse());
    expect(new Set(ids).size).toBe(53);
    expect(JSON.stringify(records)).toBe(before);
  });

  it("searches all pages case-insensitively using partial words and phrases", () => {
    const records = syntheticLibrary();
    expect(savedAcquisitionView(records, "sErViCe gRo", 1).total).toBe(27);
    expect(savedAcquisitionView(records, "etal wor", 3).records).toHaveLength(6);
    expect(savedAcquisitionView(records, "group 01", 1).records[0].id).toBe(records[0].id);
    expect(savedAcquisitionView(records, "  METAL  ", 1).total).toBe(26);
    expect(savedAcquisitionView(records, "[.*", 1).total).toBe(0);
  });

  it("clamps pages after filtering, renames, deletes and imports, including empty libraries", () => {
    const records = syntheticLibrary(51);
    expect(savedAcquisitionView(records.slice(0, 50), "", 6).page).toBe(5);
    expect(savedAcquisitionView(records, "group 01", 6).page).toBe(1);
    const renamed = records.map((r, i) => i ? r : { ...r, name: "Renamed Fabrication" });
    expect(savedAcquisitionView(renamed, "group 01", 1).total).toBe(0);
    expect(savedAcquisitionView(renamed, "Renamed", 1).total).toBe(1);
    expect(savedAcquisitionView([...records, ...syntheticLibrary(1).map(r => ({ ...r, id: "new-import" }))], "", 6).end).toBe(52);
    expect(savedAcquisitionView([], "", 99)).toMatchObject({ page: 1, totalPages: 1, total: 0, start: 0, end: 0, records: [] });
  });

  it("preserves a 53-record library through repository reload, later-page open data, update, delete and JSON import", () => {
    let raw: string | null = null;
    const store = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } };
    const repo = new AcquisitionRepository(() => store); repo.load();
    const records = syntheticLibrary();
    records.forEach(record => repo.save(record, null));
    const loaded = new AcquisitionRepository(() => store).load().records;
    expect(loaded).toHaveLength(53);
    const later = savedAcquisitionView(loaded, "", 4).records[0];
    expect(later.state).toEqual(records.find(r => r.id === later.id)!.state);
    repo.recover({ recordId: later.id, recordRevision: later.revision, state: later.state });
    expect(new AcquisitionRepository(() => store).load().draft?.state).toEqual(later.state);
    const changed = { ...later, name: "Renamed Sample", revision: later.revision + 1 };
    repo.save(changed, later.revision, true);
    expect(savedAcquisitionView(repo.load().records, "renamed", 1).records[0].id).toBe(later.id);
    repo.delete(changed.id, changed.revision, true);
    expect(repo.load().records).toHaveLength(52);
    const imported = parseBackup(serializeBackup(changed));
    repo.save(imported, null);
    expect(repo.load().records).toHaveLength(53);
    expect(repo.load().records.find(r => r.id === later.id)?.state).toEqual(later.state);
    expect(new Set(repo.load().records.map(r => r.id)).size).toBe(53);
  }, 20000);

  it("renders accessible search, ten rows and boundary controls; hides pagination for small libraries", () => {
    const records = syntheticLibrary();
    const noop = () => undefined;
    const recovery = { records, work: { scan: null }, confirmation: null, exportSavedCsv: noop } as unknown as ReturnType<typeof useAcquisitionRecovery>;
    const html = renderToStaticMarkup(<AcquisitionRecovery recovery={recovery} />);
    expect(html).toContain('placeholder="Search acquisitions..."');
    expect(html).toContain('aria-label="Search saved acquisitions by business name"');
    expect(html.match(/class="saved-acquisition-title"/g)).toHaveLength(10);
    expect(html).toContain("Showing 1–10 of 53");
    expect(html).toContain("Page 1 of 6");
    expect(html).toMatch(/<button type="button" disabled="">[\s\S]*?Previous<\/button>/);
    for (const count of [0, 3, 10]) {
      const small = renderToStaticMarkup(<AcquisitionRecovery recovery={{ ...recovery, records: records.slice(0, count) }} />);
      expect(small).not.toContain('aria-label="Saved acquisitions pages"');
      expect(small).not.toContain('class="saved-acquisition-range"');
      expect(small).toContain(`Saved scans <span>(${count})</span>`);
      expect(small).toContain('placeholder="Search acquisitions..."');
      if (!count) expect(small).toContain('No acquisitions saved in this browser yet.');
    }
    const eleven = renderToStaticMarkup(<AcquisitionRecovery recovery={{ ...recovery, records: records.slice(0, 11) }} />);
    expect(eleven).toContain('Showing 1–10 of 11');
    expect(eleven).toContain('aria-label="Saved acquisitions pages"');
  });
});
