// Illustrations of Super Charts indicators for the sign-in screen. They are
// drawn from fixed sample data (not live prices), so they look the same for
// everyone and load instantly.

type Candle = { o: number; h: number; l: number; c: number };

/** Small deterministic random generator (same picture every time). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function candles(seed: number, count: number, drift = 0): Candle[] {
  const random = rng(seed);
  let price = 100;
  return Array.from({ length: count }, (_, index) => {
    const o = price;
    const c = o + (random() - 0.5) * 4 + drift + Math.sin(index / 7) * 0.9;
    const h = Math.max(o, c) + random() * 1.6, l = Math.min(o, c) - random() * 1.6;
    price = c;
    return { o, h, l, c };
  });
}

const W = 320, UP = '#26a69a', DOWN = '#ef5350';

function scale(values: number[], top: number, bottom: number) {
  const min = Math.min(...values), max = Math.max(...values);
  return (value: number) => bottom - ((value - min) / (max - min || 1)) * (bottom - top);
}

function CandleLayer({ data, top, bottom }: { data: Candle[]; top: number; bottom: number }) {
  const y = scale(data.flatMap((bar) => [bar.h, bar.l]), top, bottom);
  const step = (W - 40) / data.length;
  return <g>{data.map((bar, index) => {
    const x = 6 + index * step, color = bar.c >= bar.o ? UP : DOWN;
    return <g key={index}>
      <line x1={x + step / 2} x2={x + step / 2} y1={y(bar.h)} y2={y(bar.l)} stroke={color} strokeWidth="1" />
      <rect x={x + 1} width={Math.max(1.5, step - 2)} y={Math.min(y(bar.o), y(bar.c))} height={Math.max(1, Math.abs(y(bar.o) - y(bar.c)))} fill={color} />
    </g>;
  })}</g>;
}

function Line({ values, top, bottom, color, width = 1.6, range }: { values: number[]; top: number; bottom: number; color: string; width?: number; range?: [number, number] }) {
  const y = range ? (value: number) => bottom - ((value - range[0]) / (range[1] - range[0])) * (bottom - top) : scale(values, top, bottom);
  const step = (W - 40) / values.length;
  return <polyline fill="none" stroke={color} strokeWidth={width} strokeLinejoin="round"
    points={values.map((value, index) => `${(6 + index * step + step / 2).toFixed(1)},${y(value).toFixed(1)}`).join(' ')} />;
}

function Divider({ y }: { y: number }) {
  return <line x1="0" x2={W} y1={y} y2={y} stroke="var(--lsar-border)" strokeWidth="1" />;
}

function BubblesArt() {
  const data = candles(7, 46, 0.05);
  const random = rng(11);
  const y = scale(data.flatMap((bar) => [bar.h, bar.l]), 14, 168);
  const step = (W - 40) / data.length;
  return <>
    <CandleLayer data={data} top={14} bottom={168} />
    {data.map((bar, index) => {
      if (random() > 0.32) return null;
      const buy = bar.c >= bar.o, r = 3 + random() * random() * 13;
      return <circle key={index} cx={6 + index * step + step / 2} cy={y(buy ? bar.l + (bar.c - bar.l) * random() : bar.h - (bar.h - bar.c) * random())}
        r={r} fill={buy ? `${UP}55` : `${DOWN}55`} stroke={buy ? UP : DOWN} strokeWidth="1" />;
    })}
  </>;
}

function LsarArt() {
  const data = candles(23, 46, -0.02);
  const random = rng(5);
  let global = 1.6, top = 0.9;
  const globalSeries = data.map(() => (global = Math.max(0.6, Math.min(2.6, global + (random() - 0.48) * 0.12))));
  const topSeries = data.map(() => (top = Math.max(0.5, Math.min(2, top + (random() - 0.52) * 0.1))));
  return <>
    <CandleLayer data={data} top={12} bottom={104} />
    <Divider y={112} />
    <line x1="0" x2={W - 34} y1={146} y2={146} stroke="#89928a" strokeDasharray="3 3" strokeWidth="1" />
    <Line values={globalSeries} top={118} bottom={172} color="#26a69a" range={[0.4, 2.8]} />
    <Line values={topSeries} top={118} bottom={172} color="#f59e0b" range={[0.4, 2.8]} />
    <text x={W - 30} y={149} fontSize="8" fill="var(--lsar-muted)">1.0</text>
  </>;
}

function LeverageArt() {
  const data = candles(41, 46, 0.08);
  const random = rng(9);
  let score = 45;
  const scores = data.map((_, index) => (score = Math.max(8, Math.min(96, score + (random() - 0.45) * 9 + (index > 30 ? 1.4 : 0)))));
  const band = (from: number, to: number, color: string) => {
    const y = (value: number) => 172 - (value / 100) * 58;
    return <rect x="0" width={W - 34} y={y(to)} height={y(from) - y(to)} fill={color} />;
  };
  return <>
    <Line values={data.map((bar) => bar.c)} top={14} bottom={104} color="var(--lsar-strong)" width={1.4} />
    <Divider y={112} />
    {band(80, 100, '#ef535022')}{band(60, 80, '#f59e0b1c')}
    <Line values={scores} top={114} bottom={172} color="#b8862f" width={2} range={[0, 100]} />
    <text x={W - 30} y={124} fontSize="8" fill="#ef5350">80</text><text x={W - 30} y={136} fontSize="8" fill="#f59e0b">60</text>
  </>;
}

function CvdArt() {
  const data = candles(77, 46, 0.03);
  const cvd = candles(78, 46, 0.06);
  return <>
    <CandleLayer data={data} top={12} bottom={100} />
    <Divider y={108} />
    <CandleLayer data={cvd} top={114} bottom={172} />
  </>;
}

const CARDS = {
  bubbles: { title: 'Aggressive Volume Bubbles', text: 'Large market buys and sells at their exact price level.', Art: BubblesArt },
  lsar: { title: 'Long Short Account Ratio', text: 'Global crowd vs top traders, weighted by open interest.', Art: LsarArt },
  leverage: { title: 'Leverage Estimate', text: 'How leveraged the market is, 0–100, across exchanges.', Art: LeverageArt },
  cvd: { title: 'Aggregated CVD', text: 'Spot and perpetual buying vs selling pressure.', Art: CvdArt },
} as const;

export function IndicatorShowcaseCard({ kind }: { kind: keyof typeof CARDS }) {
  const { title, text, Art } = CARDS[kind];
  return (
    <figure className="showcase-card" data-testid={`showcase-${kind}`}>
      <svg viewBox={`0 0 ${W} 180`} role="img" aria-label={`${title} example`} preserveAspectRatio="none">
        <rect width={W} height="180" fill="var(--lsar-page)" />
        <Art />
      </svg>
      <figcaption><strong>{title}</strong><span>{text}</span></figcaption>
    </figure>
  );
}
