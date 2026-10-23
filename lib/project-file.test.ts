import { describe, expect, it } from "vitest";
import { buildProjectFile, parseProjectFile, projectFileName } from "./project-file";
import { emptyProject } from "./sample";
import { DEFAULT_ZONE_CLASSES } from "./zone-classes";

function designed() {
  const p = emptyProject("Meydan Horizon Residential");
  p.cloudId = "cloud-row-of-the-author";
  p.zone = "Meydan";
  p.typologies = [
    { id: "t1", name: "1BR Premium", category: "1BR", internalArea: 70, balconyArea: 12, occupancy: 1.8, parkingPerUnit: 1 },
  ];
  p.program = [{ floor: 1, typologyId: "t1", count: 8 }];
  p.towerPolygons = [[{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }]];
  p.facade = { style: "curtain", glass: "bronze" };
  p.balconyGfaPct = 50;
  return p;
}

describe("project files", () => {
  it("round-trips the whole design into a NEW local project", () => {
    const src = designed();
    const parsed = parseProjectFile(buildProjectFile(src, DEFAULT_ZONE_CLASSES));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const p = parsed.project;
    expect(p.id).not.toBe(src.id);
    expect(p.cloudId).toBeUndefined(); // never writes into the author's cloud row
    expect(p.name).toBe("Meydan Horizon Residential");
    expect(p.typologies).toEqual(src.typologies);
    expect(p.program).toEqual(src.program);
    expect(p.towerPolygons).toEqual(src.towerPolygons);
    expect(p.facade).toEqual(src.facade);
    expect(p.balconyGfaPct).toBe(50);
    expect(parsed.classLibrary).toBeDefined();
  });

  it("rejects files that are not QUBE projects", () => {
    expect(parseProjectFile("not json").ok).toBe(false);
    expect(parseProjectFile(JSON.stringify({ hello: 1 })).ok).toBe(false);
    expect(parseProjectFile(JSON.stringify({ format: "qube-plot-project", version: 1, project: { name: "x" } })).ok).toBe(false);
    expect(parseProjectFile(JSON.stringify({ format: "qube-plot-project", version: 99, project: designed() })).ok).toBe(false);
  });

  it("fills defaults for fields an older export lacked", () => {
    const old = { name: "Old", typologies: [], program: [] };
    const parsed = parseProjectFile(JSON.stringify({ format: "qube-plot-project", version: 1, project: old }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(Array.isArray(parsed.project.otherUses)).toBe(true);
  });

  it("names the file after the project", () => {
    expect(projectFileName("Meydan Horizon — Residential")).toBe("Meydan-Horizon-Residential.qube.json");
  });
});
