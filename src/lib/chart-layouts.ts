/** Multi-chart layouts (CSS grid areas; a, b, c, d = chart 1–4). */
export type ChartLayout = { id: string; count: number; label: string; areas: string[] };

export const CHART_LAYOUTS: ChartLayout[] = [
  { id: '1', count: 1, label: 'One chart', areas: ['a'] },
  { id: '2v', count: 2, label: 'Two side by side', areas: ['a b'] },
  { id: '2h', count: 2, label: 'Two stacked', areas: ['a', 'b'] },
  { id: '3v', count: 3, label: 'Three side by side', areas: ['a b c'] },
  { id: '3l', count: 3, label: 'Big left, two right', areas: ['a b', 'a c'] },
  { id: '3r', count: 3, label: 'Two left, big right', areas: ['a c', 'b c'] },
  { id: '3t', count: 3, label: 'Big top, two below', areas: ['a a', 'b c'] },
  { id: '3b', count: 3, label: 'Two top, big below', areas: ['a b', 'c c'] },
  { id: '4g', count: 4, label: 'Four in a grid', areas: ['a b', 'c d'] },
  { id: '4l', count: 4, label: 'Big left, three right', areas: ['a b', 'a c', 'a d'] },
  { id: '4t', count: 4, label: 'Big top, three below', areas: ['a a a', 'b c d'] },
  { id: '4b', count: 4, label: 'Three top, big below', areas: ['a b c', 'd d d'] },
  { id: '4v', count: 4, label: 'Four side by side', areas: ['a b c d'] },
];
export const CELL_AREAS = ['a', 'b', 'c', 'd'];
export const layoutById = (id: string) => CHART_LAYOUTS.find((layout) => layout.id === id) ?? CHART_LAYOUTS[0];
export const gridStyle = (layout: ChartLayout) => ({
  gridTemplateAreas: layout.areas.map((row) => `"${row}"`).join(' '),
  gridTemplateColumns: `repeat(${layout.areas[0].split(' ').length}, minmax(0, 1fr))`,
  gridTemplateRows: `repeat(${layout.areas.length}, minmax(0, 1fr))`,
});
