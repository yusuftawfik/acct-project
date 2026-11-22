// Formatting and small helpers shared by the components.

/** 118188087 -> "118,188,087.00" */
export const f2 = (n) =>
  Number(n).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 12 -> "E0012" */
export const eid = (n) => 'E' + String(n).padStart(4, '0');

/** Text typed in an amount box -> whole cents (so totals never suffer from decimal rounding noise). */
export const toCents = (text) => {
  const n = Number(text);
  return Number.isFinite(n) ? Math.round(Number(n.toFixed(2)) * 100) : 0;
};

/** The 12 months of the financial year, from its start date 'YYYY-MM-DD'. */
export function monthsOf(fyStart) {
  const [y, m] = fyStart.split('-').map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(y, m - 1 + i, 1);
    return {
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleString('en', { month: 'short', year: 'numeric' }),
    };
  });
}

/** Last day of the financial year as 'YYYY-MM-DD'. */
export function fyEnd(fyStart) {
  const [y, m] = fyStart.split('-').map(Number);
  return new Date(Date.UTC(y + 1, m - 1, 0)).toISOString().slice(0, 10);
}
