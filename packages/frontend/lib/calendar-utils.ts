// packages/frontend/lib/calendar-utils.ts

export const DAYS_DA = ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn'];
export const MONTHS_DA = [
  'Januar', 'Februar', 'Marts', 'April', 'Maj', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'December',
];

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

export function previousMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() - 1, 1);
}

export function nextMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

export function isToday(date: Date): boolean {
  return sameDay(date, new Date());
}

/**
 * Returns a 6-row × 7-col grid. Cells are day numbers (1-31) or null for padding.
 * Week starts on Monday.
 */
export function buildMonthGrid(date: Date): (number | null)[][] {
  const first = startOfMonth(date);
  // Monday=0 … Sunday=6
  const startPad = (first.getDay() + 6) % 7;
  const daysInMonth = endOfMonth(date).getDate();
  const cells: (number | null)[] = [
    ...Array(startPad).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

export function formatDayHeading(date: Date): string {
  return date.toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function formatTimeRange(startIso: string, endIso: string): string {
  const fmt = (iso: string) => new Date(iso).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
  return `${fmt(startIso)} – ${fmt(endIso)}`;
}
