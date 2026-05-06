export const fmt0 = (n: number) =>
  Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "—";
export const fmt2 = (n: number) =>
  Number.isFinite(n) ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
export const fmtPct = (n: number, digits = 1) =>
  Number.isFinite(n) ? `${(n * 100).toFixed(digits)}%` : "—";
export const fmtMoney = (n: number, currency = "AED") =>
  Number.isFinite(n)
    ? `${currency} ${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : "—";
export const fmtMoneyShort = (n: number, currency = "AED") => {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${currency} ${(n / 1_000_000_000).toFixed(2)} B`;
  if (abs >= 1_000_000) return `${currency} ${(n / 1_000_000).toFixed(2)} M`;
  if (abs >= 1_000) return `${currency} ${(n / 1_000).toFixed(1)} K`;
  return `${currency} ${n.toFixed(0)}`;
};

