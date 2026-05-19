import ExcelJS from "exceljs";
import type { Project } from "./types";
import { effectiveCommonAreaTotal } from "./types";
import { analyze } from "./calc";

const HDR_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } } as const;
const SUB_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } } as const;
const HDR_FONT = { bold: true, color: { argb: "FFFFFFFF" } };
const BOLD = { bold: true };

function applyHeader(row: ExcelJS.Row) {
  row.eachCell((c) => {
    c.fill = HDR_FILL as ExcelJS.FillPattern;
    c.font = HDR_FONT;
    c.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  });
  row.height = 22;
}
function applySubtotal(row: ExcelJS.Row) {
  row.eachCell((c) => {
    c.fill = SUB_FILL as ExcelJS.FillPattern;
    c.font = BOLD;
  });
}
function setColWidths(ws: ExcelJS.Worksheet, widths: number[]) {
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
}

export async function exportToExcel(project: Project) {
  const r = analyze(project);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Qube Plot Analysis";
  wb.created = new Date();

  // ===== 1. Setup =====
  const wsSetup = wb.addWorksheet("0.Setup");
  wsSetup.addRow([`PROJECT: ${project.name}`]);
  wsSetup.getCell("A1").font = { bold: true, size: 14 };
  wsSetup.addRow([]);
  wsSetup.addRow(["Field", "Value"]);
  applyHeader(wsSetup.lastRow!);
  const setupRows: [string, string | number][] = [
    ["Use", project.use],
    ["Dubai zone", project.zone],
    ["Plot area (m²)", project.plotArea],
    ["Number of floors", project.numFloors],
    ["Floor height (m)", project.floorHeight],
    ["Shafts per unit (m²)", project.shaftPerUnit],
    ["PRM parking %", project.prmPercent],
    ["Total GFA (m²)", Number(r.program.totalGFABuilding.toFixed(2))],
    ["Total BUA (m²)", Number(r.program.totalBUABuilding.toFixed(2))],
    ["FAR", Number(r.program.far.toFixed(3))],
  ];
  setupRows.forEach((row) => wsSetup.addRow(row));
  setColWidths(wsSetup, [32, 24]);

  // ===== 1.Parking =====
  const wsP = wb.addWorksheet("1.Parking");
  wsP.addRow([`PARKING SPACES INVENTORY — ${project.name.toUpperCase()}`]);
  wsP.getCell("A1").font = { bold: true, size: 14 };
  wsP.addRow([]);
  wsP.addRow(["Level", "Standard", "PRM", "Total", "Notes"]);
  applyHeader(wsP.lastRow!);
  for (const lvl of r.parking.byLevel) {
    wsP.addRow([lvl.name, lvl.standard, lvl.prm, lvl.total, ""]);
  }
  wsP.addRow(["PROJECT TOTAL", r.parking.availableStandard, r.parking.availablePRM, r.parking.availableTotal, ""]);
  applySubtotal(wsP.lastRow!);

  wsP.addRow([]);
  wsP.addRow(["PARKING REQUIREMENT"]);
  wsP.lastRow!.font = BOLD;
  wsP.addRow(["Category", "Units", "Spaces / unit", "Required", ""]);
  applyHeader(wsP.lastRow!);
  for (const rc of r.parking.requiredByCategory) {
    wsP.addRow([rc.category, rc.units, rc.ratio, rc.required, ""]);
  }
  for (const ou of r.parking.otherUsesRequired) {
    wsP.addRow([`Other: ${ou.name}`, ou.netArea, `${ou.ratio}/100m²`, Number(ou.required.toFixed(2)), ""]);
  }
  wsP.addRow(["TOTAL REQUIRED", "", "", r.parking.grandRequired, ""]);
  applySubtotal(wsP.lastRow!);
  wsP.addRow([`Of which PRM (${(project.prmPercent * 100).toFixed(0)}%)`, "", "", r.parking.requiredPRM, `PRM balance: ${r.parking.prmBalance}`]);
  wsP.addRow(["BALANCE", "", "", r.parking.grandBalance, "Available − required"]);
  applySubtotal(wsP.lastRow!);
  setColWidths(wsP, [38, 14, 16, 14, 32]);

  // ===== 2.Program =====
  const wsProg = wb.addWorksheet("2.Program");
  wsProg.addRow([`BUILDING PROGRAM — ${project.name.toUpperCase()}`]);
  wsProg.getCell("A1").font = { bold: true, size: 14 };
  wsProg.addRow([]);

  wsProg.addRow(["Floor", "Typology", "Units", "Int. area (m²)", "Balcony (m²)", "Total balcony (m²)", "Sellable / unit (m²)", "Total sellable (m²)", "Total interior GFA (m²)"]);
  applyHeader(wsProg.lastRow!);

  const tById = new Map(project.typologies.map((t) => [t.id, t]));
  for (const f of r.program.byFloor) {
    const cells = project.program.filter((c) => c.floor === f.floor && c.count > 0);
    for (const cell of cells) {
      const t = tById.get(cell.typologyId);
      if (!t) continue;
      wsProg.addRow([
        `Floor ${f.floor}`,
        t.name,
        cell.count,
        t.internalArea,
        t.balconyArea,
        Number((cell.count * t.balconyArea).toFixed(2)),
        Number((t.internalArea + t.balconyArea).toFixed(2)),
        Number((cell.count * (t.internalArea + t.balconyArea)).toFixed(2)),
        Number((cell.count * t.internalArea).toFixed(2)),
      ]);
    }
    wsProg.addRow([
      `Subtotal Floor ${f.floor}`, "", f.units, "", "", Number(f.totalBalcony.toFixed(2)), "",
      Number(f.totalSellable.toFixed(2)), Number(f.totalInteriorGFA.toFixed(2)),
    ]);
    applySubtotal(wsProg.lastRow!);
  }

  wsProg.addRow([]);
  wsProg.addRow(["SHAFTS DEDUCTION", "", r.program.totalUnits, "", "", "", "", "", -r.program.shaftsDeduction]);
  applySubtotal(wsProg.lastRow!);
  wsProg.addRow(["TOTAL RESIDENTIAL", "", r.program.totalUnits, "", "", Number(r.program.totalBalcony.toFixed(2)), "", Number(r.program.totalSellable.toFixed(2)), Number(r.program.totalInteriorGFA.toFixed(2))]);
  applySubtotal(wsProg.lastRow!);

  wsProg.addRow([]);
  wsProg.addRow(["COMMON AREAS & SERVICES"]);
  wsProg.lastRow!.font = BOLD;
  wsProg.addRow(["Element", "Area (m²)", "Floors", "Total (m²)", "Counts as GFA", "Notes"]);
  applyHeader(wsProg.lastRow!);
  for (const c of project.commonAreas) {
    const cat = (c.category ?? (c.countAsGFA === false ? "OPEN" : "GFA"));
    const totalArea = effectiveCommonAreaTotal(c, project);
    wsProg.addRow([c.name, c.area, c.floors, Number(totalArea.toFixed(2)), cat, c.notes ?? ""]);
  }
  wsProg.addRow(["Subtotal · GFA", "", "", Number(r.program.commonAreasGFA.toFixed(2))]);
  applySubtotal(wsProg.lastRow!);
  wsProg.addRow(["Subtotal · BUA only", "", "", Number(r.program.commonAreasBUAonly.toFixed(2))]);
  wsProg.addRow(["Subtotal · Open air", "", "", Number(r.program.commonAreasOpen.toFixed(2))]);

  wsProg.addRow([]);
  wsProg.addRow(["TOTAL GFA BUILDING", "", "", Number(r.program.totalGFABuilding.toFixed(2)), `FAR ${r.program.far.toFixed(3)}`]);
  applySubtotal(wsProg.lastRow!);
  wsProg.addRow(["TOTAL BUA BUILDING", "", "", Number(r.program.totalBUABuilding.toFixed(2)), "Includes balconies + BUA-only commons"]);
  applySubtotal(wsProg.lastRow!);

  wsProg.addRow([]);
  wsProg.addRow(["EFFICIENCY"]);
  wsProg.lastRow!.font = BOLD;
  wsProg.addRow(["Category", "GFA (m²)", "% of Total GFA"]);
  applyHeader(wsProg.lastRow!);
  const eff = r.program.efficiency;
  const effRows: [string, number, number][] = [
    ["Residential (net of shafts)", Number(eff.residentialNetGFA.toFixed(2)), Number(eff.residentialNetPct.toFixed(4))],
    ["Circulation", Number(eff.circulationGFA.toFixed(2)), Number(eff.circulationPct.toFixed(4))],
    ["Services / MEP", Number(eff.servicesGFA.toFixed(2)), Number(eff.servicesPct.toFixed(4))],
    ["Amenities (GFA)", Number(eff.amenitiesGFAarea.toFixed(2)), Number(eff.amenitiesPct.toFixed(4))],
  ];
  effRows.forEach((row) => {
    const r = wsProg.addRow(row);
    r.getCell(3).numFmt = "0.0%";
  });
  setColWidths(wsProg, [22, 26, 12, 18, 18, 22, 22, 22, 22]);

  // ===== 3.Lifts =====
  const wsL = wb.addWorksheet("3.Lifts");
  wsL.addRow([`LIFT CALCULATION — ${project.name.toUpperCase()} (Dubai Building Code D.8.8)`]);
  wsL.getCell("A1").font = { bold: true, size: 14 };
  wsL.addRow([]);
  wsL.addRow(["STEP 1 — POPULATION BY FLOOR"]);
  wsL.lastRow!.font = BOLD;
  wsL.addRow(["Floor", "Units", "Population"]);
  applyHeader(wsL.lastRow!);
  for (const f of r.lifts.byFloor) wsL.addRow([`Floor ${f.floor}`, f.units, Number(f.population.toFixed(2))]);
  wsL.addRow(["TOTAL", r.lifts.totalUnits, Number(r.lifts.totalPopulation.toFixed(2))]);
  applySubtotal(wsL.lastRow!);

  wsL.addRow([]);
  wsL.addRow(["STEP 2 — D.8.8 INPUTS"]);
  wsL.lastRow!.font = BOLD;
  wsL.addRow(["Parameter", "Value", "Notes"]);
  applyHeader(wsL.lastRow!);
  wsL.addRow(["Occupied floors", r.lifts.occupiedFloors, "Residential / type floors"]);
  wsL.addRow(["Boarding floors", r.lifts.boardingFloors, "Basements + Ground + Podium"]);
  wsL.addRow(["Population", Number(r.lifts.totalPopulation.toFixed(2)), "Per Table D.5"]);

  wsL.addRow([]);
  wsL.addRow(["STEP 3 — LIFTS REQUIRED (D.8.8)"]);
  wsL.lastRow!.font = BOLD;
  wsL.addRow(["Criterion", "Lifts", "Notes"]);
  applyHeader(wsL.lastRow!);
  wsL.addRow(["From population (Fig D.13)", r.lifts.dbcFromPopulation ?? "—", ""]);
  wsL.addRow(["From boarding floors (Fig D.14)", r.lifts.dbcFromBoarding ?? "—", ""]);
  wsL.addRow(["RECOMMENDED", r.lifts.liftsRecommended, r.lifts.governing]);
  applySubtotal(wsL.lastRow!);

  wsL.addRow([]);
  wsL.addRow(["STEP 4 — CABIN SPECS (Table D.6)"]);
  wsL.lastRow!.font = BOLD;
  wsL.addRow(["Type", "Rated kg", "Persons", "Cabin W×D (mm)", "Door W×H (mm)"]);
  applyHeader(wsL.lastRow!);
  wsL.addRow([`Passenger (${r.lifts.passengerMin.description})`, r.lifts.passengerMin.ratedKg, r.lifts.passengerMin.persons, `${r.lifts.passengerMin.cabinW_mm}×${r.lifts.passengerMin.cabinD_mm}`, `${r.lifts.passengerMin.doorW_mm}×${r.lifts.passengerMin.doorH_mm}`]);
  if (r.lifts.occupiedFloors > 10) {
    wsL.addRow([`Passenger (${r.lifts.passengerRecommended.description})`, r.lifts.passengerRecommended.ratedKg, r.lifts.passengerRecommended.persons, `${r.lifts.passengerRecommended.cabinW_mm}×${r.lifts.passengerRecommended.cabinD_mm}`, `${r.lifts.passengerRecommended.doorW_mm}×${r.lifts.passengerRecommended.doorH_mm}`]);
  }
  wsL.addRow([`Service (${r.lifts.serviceMin.description})`, r.lifts.serviceMin.ratedKg, r.lifts.serviceMin.persons, `${r.lifts.serviceMin.cabinW_mm}×${r.lifts.serviceMin.cabinD_mm}`, `${r.lifts.serviceMin.doorW_mm}×${r.lifts.serviceMin.doorH_mm}`]);
  setColWidths(wsL, [38, 18, 14, 22, 22]);

  // ===== 4.Garbage Room =====
  const wsG = wb.addWorksheet("4.Garbage Room");
  wsG.addRow([`WASTE ROOM DIMENSIONING — ${project.name.toUpperCase()}`]);
  wsG.getCell("A1").font = { bold: true, size: 14 };
  wsG.addRow([]);
  wsG.addRow(["Parameter", "Value", "Unit", "Notes"]);
  applyHeader(wsG.lastRow!);
  wsG.addRow(["Residential GFA", Number(r.garbage.residentialGFA.toFixed(2)), "m²", "From Program"]);
  wsG.addRow(["Daily waste generation", r.garbage.dailyWasteKg, "kg/day", "12 kg/100m²/day × GFA"]);
  wsG.addRow(["Storage capacity (2 days)", r.garbage.storageKg, "kg", ""]);
  wsG.addRow(["Volume required", r.garbage.volumeRequiredM3, "m³", "÷ 150 kg/m³"]);
  wsG.addRow(["N° containers (2.5 m³)", r.garbage.containers, "units", ""]);
  wsG.addRow(["Room width", r.garbage.roomWidthM, "m", "N × 1.37 + (N+1) × 0.15"]);
  wsG.addRow(["Room depth", r.garbage.roomDepthM, "m", "2.04 + 0.6 clearance"]);
  wsG.addRow(["TOTAL ROOM AREA", r.garbage.roomAreaM2, "m²", ""]);
  applySubtotal(wsG.lastRow!);
  setColWidths(wsG, [32, 16, 10, 36]);

  // ===== 5.Conclusions =====
  const wsC = wb.addWorksheet("5.Conclusions");
  wsC.addRow([`PROJECT ANALYSIS — ${project.name.toUpperCase()}`]);
  wsC.getCell("A1").font = { bold: true, size: 14 };
  wsC.addRow([]);
  wsC.addRow(["Area", "Status", "Detail"]);
  applyHeader(wsC.lastRow!);
  const checks: [string, string, string][] = [
    ["Parking total", r.parking.grandBalance >= 0 ? "OK" : "REVIEW", `${r.parking.availableTotal} available vs ${r.parking.grandRequired} required (${r.parking.grandBalance >= 0 ? "+" : ""}${r.parking.grandBalance})`],
    ["PRM parking", r.parking.prmBalance >= 0 ? "OK" : "REVIEW", `${r.parking.availablePRM} available vs ${r.parking.requiredPRM} required`],
    ["Lifts", "INFO", `Recommended ${r.lifts.liftsRecommended} (${r.lifts.governing})`],
    ["Garbage room", "INFO", `${r.garbage.containers} containers · ${r.garbage.roomAreaM2.toFixed(2)} m²`],
    ["GFA / FAR", "INFO", `Total GFA ${r.program.totalGFABuilding.toFixed(2)} m² · FAR ${r.program.far.toFixed(3)}`],
  ];
  checks.forEach((c) => wsC.addRow(c));
  if (project.notes) {
    wsC.addRow([]);
    wsC.addRow(["NOTES"]).font = BOLD;
    project.notes.split("\n").forEach((line) => wsC.addRow([line]));
  }
  setColWidths(wsC, [22, 14, 80]);

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safe = (project.name || "project").replace(/[^\w-]+/g, "_");
  a.href = url;
  a.download = `${safe}_analysis.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
