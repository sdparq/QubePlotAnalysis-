"use client";
import { useMemo } from "react";
import { useStore, useProject } from "@/lib/store";
import { computeFeasibility } from "@/lib/calc/feasibility";
import { computeProgram } from "@/lib/calc/program";
import { computeEconomic } from "@/lib/calc/economic";
import { fmt0, fmtMoneyShort, fmtPct } from "@/lib/format";

const M2_TO_SQFT = 10.7639;
const fmtSqft = (m2: number) =>
  Number.isFinite(m2) && m2 !== 0 ? `${Math.round(m2 * M2_TO_SQFT).toLocaleString("en-US")} sqft` : "—";

export default function AnalysisTab({ onGoTo }: { onGoTo?: (tabId: string) => void }) {
  const project = useProject();
  const patch = useStore((s) => s.patch);
  const f = useMemo(() => computeFeasibility(project), [project]);
  const program = useMemo(() => computeProgram(project), [project]);
  const econ = useMemo(() => computeEconomic(project), [project]);

  const go = (id: string) => onGoTo?.(id);

  return (
    <div className="grid gap-6">
      {/* ---------- Hero: the question this tab answers ---------- */}
      <div className="card bg-ink-900 text-bone-100 border-ink-900">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div>
            <div className="eyebrow text-bone-200/60 text-[10px]">Feasibility analysis</div>
            <h2 className="text-[22px] font-light mt-1">
              {project.name || "Untitled project"}
              {f.detectedClass && <span className="text-bone-200/60 text-[14px] ml-3">zone {project.zone} · class {f.detectedClass}</span>}
            </h2>
            <p className="text-[12.5px] text-bone-200/80 mt-1 max-w-[560px] leading-snug">
              Qué se puede construir en este solar con los datos actuales. Cada número indica de dónde sale;
              los que faltan te llevan a la pestaña donde se completan.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-6 text-right">
            <div>
              <div className="text-[28px] font-light tabular-nums">{f.maxTowerFloors ? fmt0(f.maxTowerFloors.value) : "—"}</div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-bone-200/60">Max tower floors</div>
            </div>
            <div>
              <div className="text-[28px] font-light tabular-nums">{f.estimatedUnits ? fmt0(f.estimatedUnits.value) : "—"}</div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-bone-200/60">Units (est.)</div>
            </div>
            <div>
              <div className="text-[28px] font-light tabular-nums">{econ.profit !== 0 ? fmtMoneyShort(econ.profit, econ.currency) : "—"}</div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-bone-200/60">Net profit</div>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- Missing inputs ---------- */}
      {f.missing.length > 0 && (
        <div className="border border-amber-200 bg-amber-50 p-4">
          <div className="eyebrow text-amber-900 text-[10px] mb-1.5">Para completar el análisis falta</div>
          <ul className="grid gap-1 text-[12.5px] text-amber-900">
            {f.missing.map((m) => (
              <li key={m} className="flex items-center gap-2">
                <span className="text-amber-500">→</span> {m}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---------- Step 1 · GFA budget ---------- */}
      <div className="card">
        <StepTitle n={1} title="¿Cuánta superficie se puede construir?" onEdit={() => go("setup")} editLabel="Setup" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Fact label="Plot area" value={f.plotArea > 0 ? `${fmt0(f.plotArea)} m²` : "—"} sub={fmtSqft(f.plotArea)} />
          <Fact label="Max FAR" value={f.maxFAR ? `${f.maxFAR}` : "—"} sub={f.maxFAR ? "de zoning / affection plan" : "sin definir"} />
          <Fact
            label="Max GFA (FAR)"
            value={f.maxGFA ? `${fmt0(f.maxGFA.value)} m²` : "—"}
            sub={f.maxGFA?.basis ?? "define Max FAR en Setup"}
            highlight
          />
          <Fact
            label="Target GFA actual"
            value={f.targetGFA > 0 ? `${fmt0(f.targetGFA)} m²` : "—"}
            sub={
              f.gfaGapVsMax === null
                ? ""
                : f.gfaGapVsMax >= 0
                ? `${fmt0(f.gfaGapVsMax)} m² de margen hasta el máximo`
                : `⚠ excede el máximo en ${fmt0(-f.gfaGapVsMax)} m²`
            }
            bad={f.gfaGapVsMax !== null && f.gfaGapVsMax < 0}
          />
        </div>
        {f.maxGFA && f.gfaGapVsMax !== null && Math.abs(f.gfaGapVsMax) > 1 && (
          <button
            className="mt-3 text-[11px] uppercase tracking-[0.10em] text-qube-700 hover:text-qube-900 underline"
            onClick={() => patch({ targetGFA: Math.round(f.maxGFA!.value) })}
          >
            Usar el máximo ({fmt0(f.maxGFA.value)} m²) como Target GFA
          </button>
        )}
      </div>

      {/* ---------- Step 2 · Floors ---------- */}
      <div className="card">
        <StepTitle n={2} title="¿Cuántas plantas caben?" onEdit={() => go("massing")} editLabel="Massing" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Fact label="Tower footprint" value={f.towerFootprint > 0 ? `${fmt0(f.towerFootprint)} m²` : "—"} sub="huella con setbacks aplicados" />
          <Fact
            label="Max tower floors"
            value={f.maxTowerFloors ? fmt0(f.maxTowerFloors.value) : "—"}
            sub={f.maxTowerFloors?.basis ?? "necesita Max FAR"}
            highlight
          />
          <Fact
            label="Plantas actuales"
            value={`${f.groundFloors}+${f.podiumFloors}+${f.currentTowerFloors}`}
            sub="ground + podium + torre (Setup)"
          />
          <Fact
            label="Altura"
            value={`${f.totalHeightM.toFixed(1)} m`}
            sub={f.maxHeightM ? `máx. posible ≈ ${f.maxHeightM.value.toFixed(1)} m` : ""}
          />
        </div>
        {f.maxTowerFloors && f.maxTowerFloors.value !== f.currentTowerFloors && (
          <button
            className="mt-3 text-[11px] uppercase tracking-[0.10em] text-qube-700 hover:text-qube-900 underline"
            onClick={() => {
              const count = f.maxTowerFloors!.value;
              const heightM = project.typeFloors?.heightM ?? project.floorHeight;
              patch({ typeFloors: { count, heightM }, numFloors: Math.max(1, count) });
            }}
          >
            Aplicar {fmt0(f.maxTowerFloors.value)} plantas de torre al proyecto
          </button>
        )}
      </div>

      {/* ---------- Step 3 · Units ---------- */}
      <div className="card">
        <StepTitle n={3} title="¿Cuántas viviendas salen?" onEdit={() => go("typologies")} editLabel="Typologies" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Fact
            label="Apartments GFA"
            value={f.apartmentsGFA > 0 ? `${fmt0(f.apartmentsGFA)} m²` : "—"}
            sub={`${f.apartmentsPct.toFixed(0)}% del residencial (Distribution)`}
          />
          <Fact
            label="Viviendas estimadas"
            value={f.estimatedUnits ? fmt0(f.estimatedUnits.value) : "—"}
            sub={f.estimatedUnits?.basis ?? "necesita typologies + GFA residencial"}
            highlight
          />
          <Fact
            label="En la matriz actual"
            value={program.totalUnits > 0 ? fmt0(program.totalUnits) : "—"}
            sub="unidades colocadas en Apartments"
          />
          <div className="border border-ink-200 bg-white p-3">
            <div className="eyebrow text-ink-500 text-[10px]">Mix estimado</div>
            {f.unitsByCategory.length === 0 ? (
              <div className="text-[13px] text-ink-400 mt-1">—</div>
            ) : (
              <div className="text-[12px] text-ink-900 mt-1 leading-relaxed tabular-nums">
                {f.unitsByCategory.map((u) => `${u.units} ${u.category}`).join(" · ")}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ---------- Step 4 · Parking ---------- */}
      <div className="card">
        <StepTitle n={4} title="¿Cabe el parking?" onEdit={() => go("parking")} editLabel="Parking" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Fact label="Plazas requeridas" value={f.parkingRequired > 0 ? fmt0(f.parkingRequired) : "—"} sub="viviendas + retail + PRM" />
          <Fact label="Plazas disponibles" value={f.parkingAvailable > 0 ? fmt0(f.parkingAvailable) : "—"} sub="sótanos + otras plantas" />
          <Fact
            label="Balance"
            value={f.parkingRequired > 0 || f.parkingAvailable > 0 ? `${f.parkingBalanceSpaces >= 0 ? "+" : ""}${fmt0(f.parkingBalanceSpaces)}` : "—"}
            sub={f.parkingBalanceSpaces >= 0 ? "sobran plazas" : "faltan plazas — añade sótano"}
            highlight={f.parkingBalanceSpaces >= 0}
            bad={f.parkingRequired > 0 && f.parkingBalanceSpaces < 0}
          />
          <Fact label="Sótanos" value={`${project.basements?.count ?? 0}`} sub="Setup → floor breakdown" />
        </div>
      </div>

      {/* ---------- Step 5 · Economics ---------- */}
      <div className="card">
        <StepTitle n={5} title="¿Salen los números?" onEdit={() => go("economic")} editLabel="Economic" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Fact label="GDV (ingresos)" value={econ.totalRevenue > 0 ? fmtMoneyShort(econ.totalRevenue, econ.currency) : "—"} sub="ventas residencial + retail + parking" />
          <Fact label="TDC (costes)" value={econ.totalCost > 0 ? fmtMoneyShort(econ.totalCost, econ.currency) : "—"} sub="suelo + construcción + soft costs" />
          <Fact
            label="Beneficio neto"
            value={econ.totalRevenue > 0 ? fmtMoneyShort(econ.profit, econ.currency) : "—"}
            sub="tras impuesto de sociedades UAE"
            highlight={econ.profit > 0}
            bad={econ.totalRevenue > 0 && econ.profit < 0}
          />
          <Fact
            label="Margen / GDV"
            value={econ.totalRevenue > 0 ? fmtPct(econ.marginOnGDV) : "—"}
            sub={econ.marginOnGDV >= 0.15 ? "≥15% — sano" : econ.totalRevenue > 0 ? "<15% — ajustar" : ""}
          />
        </div>
      </div>
    </div>
  );
}

function StepTitle({ n, title, onEdit, editLabel }: { n: number; title: string; onEdit?: () => void; editLabel?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-4">
      <div className="flex items-center gap-3">
        <span className="w-7 h-7 flex items-center justify-center bg-qube-500 text-white text-[13px] font-medium">{n}</span>
        <h2 className="section-title !mb-0">{title}</h2>
      </div>
      {onEdit && (
        <button
          onClick={onEdit}
          className="text-[10.5px] uppercase tracking-[0.10em] text-ink-500 hover:text-qube-700"
        >
          Editar en {editLabel} →
        </button>
      )}
    </div>
  );
}

function Fact({
  label, value, sub, highlight, bad,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
  bad?: boolean;
}) {
  return (
    <div className={`border p-3 ${bad ? "border-red-200 bg-red-50" : highlight ? "border-qube-200 bg-qube-50" : "border-ink-200 bg-white"}`}>
      <div className="eyebrow text-ink-500 text-[10px]">{label}</div>
      <div className={`text-[19px] font-light mt-0.5 tabular-nums ${bad ? "text-red-700" : highlight ? "text-qube-800" : "text-ink-900"}`}>{value}</div>
      {sub && <div className="text-[10.5px] text-ink-500 mt-0.5 leading-snug">{sub}</div>}
    </div>
  );
}
