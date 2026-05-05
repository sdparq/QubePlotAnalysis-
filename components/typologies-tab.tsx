"use client";
import { useStore } from "@/lib/store";
import type { Typology, UnitCategory } from "@/lib/types";

const CATEGORIES: UnitCategory[] = ["Studio", "1BR", "2BR", "3BR", "4BR", "Penthouse"];

const DEFAULT_PARKING: Record<UnitCategory, number> = {
  Studio: 1, "1BR": 1, "2BR": 1, "3BR": 2, "4BR": 2, Penthouse: 2,
};
const DEFAULT_OCCUPANCY: Record<UnitCategory, number> = {
  Studio: 1.5, "1BR": 2, "2BR": 3, "3BR": 5, "4BR": 6, Penthouse: 6,
};

export default function TypologiesTab() {
  const project = useStore((s) => s.project);
  const upsert = useStore((s) => s.upsertTypology);
  const remove = useStore((s) => s.removeTypology);

  function addNew() {
    upsert({
      id: `t-${Date.now()}`,
      name: "New Typology",
      category: "Studio",
      internalArea: 0,
      balconyArea: 0,
      occupancy: DEFAULT_OCCUPANCY.Studio,
      parkingPerUnit: DEFAULT_PARKING.Studio,
    });
  }

  function update(t: Typology, patch: Partial<Typology>) {
    upsert({ ...t, ...patch });
  }

  return (
    <div className="grid gap-6">
      <div className="card">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="section-title">Typologies</h2>
            <p className="section-sub">Define each unit type used in the project. Areas in m². Occupancy and parking ratios drive the lift and parking calculations.</p>
          </div>
          <button className="btn btn-primary" onClick={addNew}>+ Add typology</button>
        </div>
        {project.typologies.length === 0 ? (
          <div className="text-sm text-ink-500 italic py-10 text-center">No typologies yet — add one to start.</div>
        ) : (
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="tbl">
              <colgroup>
                <col style={{ width: "22%" }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 120 }} />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th className="text-right">Interior (m²)</th>
                  <th className="text-right">Balcony (m²)</th>
                  <th className="text-right">Total (m²)</th>
                  <th className="text-right">Occupancy</th>
                  <th className="text-right">Parking / unit</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {project.typologies.map((t) => (
                  <tr key={t.id}>
                    <td className="cell-edit">
                      <input className="cell-input" value={t.name} onChange={(e) => update(t, { name: e.target.value })} />
                    </td>
                    <td className="cell-edit">
                      <select
                        className="cell-input"
                        value={t.category}
                        onChange={(e) => {
                          const cat = e.target.value as UnitCategory;
                          update(t, { category: cat, occupancy: DEFAULT_OCCUPANCY[cat], parkingPerUnit: DEFAULT_PARKING[cat] });
                        }}
                      >
                        {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                      </select>
                    </td>
                    <td className="cell-edit">
                      <input type="number" step={0.01} className="cell-input text-right"
                        value={t.internalArea} onChange={(e) => update(t, { internalArea: parseFloat(e.target.value) || 0 })} />
                    </td>
                    <td className="cell-edit">
                      <input type="number" step={0.01} className="cell-input text-right"
                        value={t.balconyArea} onChange={(e) => update(t, { balconyArea: parseFloat(e.target.value) || 0 })} />
                    </td>
                    <td className="text-right">{(t.internalArea + t.balconyArea).toFixed(2)}</td>
                    <td className="cell-edit">
                      <input type="number" step={0.1} className="cell-input text-right"
                        value={t.occupancy} onChange={(e) => update(t, { occupancy: parseFloat(e.target.value) || 0 })} />
                    </td>
                    <td className="cell-edit">
                      <input type="number" step={0.1} className="cell-input text-right"
                        value={t.parkingPerUnit} onChange={(e) => update(t, { parkingPerUnit: parseFloat(e.target.value) || 0 })} />
                    </td>
                    <td className="text-right">
                      <button className="btn btn-danger btn-xs" onClick={() => { if (confirm(`Delete ${t.name}?`)) remove(t.id); }}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
