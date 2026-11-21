// Inputs for the OI Market Driver pane, one row per chart candle: the chart's price
// candle, aggregated OI of every exchange (coins), aggregated perpetual CVD with
// taker buy/sell volume (USD, every recorded exchange, CVD anchored daily),
// recorded long/short liquidations (USD) and the Top Trader long/short account ratio.
// The Market Driver classification itself runs in the browser (src/lib/market-driver.js).
import { canonicalAsset } from "./assetIdentity.js";
import { isCryptoAsset } from "./cryptoAssets.js";
import { CHART_TIMEFRAMES, bucketStart, nextBucket } from "./timeframes.js";
import { LSAR_CHART_FRAMES, getLsarChart } from "./lsarChart.js";

const lsarFrameFor = timeframe => LSAR_CHART_FRAMES.includes(timeframe) ? timeframe
  : ["1m", "3m"].includes(timeframe) ? "5m" : "24h";

export function createMarketDriverService({ candles: candleSource, aggregatedOi, cvd, lsar = getLsarChart, now = Date.now }) {
  async function get(query) {
    const asset = typeof query.asset === "string" ? canonicalAsset(query.asset.trim().toUpperCase()).asset : "";
    const timeframe = query.timeframe ?? "1h";
    if (!/^[A-Z0-9]{1,30}$/.test(asset) || !isCryptoAsset(asset) || !CHART_TIMEFRAMES.includes(timeframe) ||
      typeof query.exchange !== "string" || typeof query.symbol !== "string")
      throw Object.assign(new Error("A crypto asset, chart contract and a timeframe from 1m to 3M are required."), { status: 400 });
    const [price, oi] = await Promise.all([
      candleSource.get({ exchange: query.exchange, symbol: query.symbol, timeframe }),
      aggregatedOi.get({ asset, timeframe }),
    ]);
    let flow = null;
    try { flow = cvd.get({ asset, market: "perpetual", timeframe, anchor: "1d" }); } catch { flow = null; }
    let daily = null;
    try { daily = cvd.get({ asset, market: "perpetual", timeframe: "24h", anchor: "1d" }); } catch { daily = null; }
    let ratio = [];
    try { ratio = lsar({ asset, kind: "top", timeframe: lsarFrameFor(timeframe) }).points ?? []; } catch { ratio = []; }
    const liquidation = cvd.liquidationSnapshot(asset);

    const oiByTime = new Map((oi.candles ?? []).map(bar => [bar.time, bar]));
    const cvdByTime = new Map((flow?.candles ?? []).map(bar => [bar.time, bar]));
    const liqByTime = new Map();
    for (const event of liquidation.events ?? []) {
      const time = bucketStart(timeframe, Math.floor(event.time / 1000));
      const row = liqByTime.get(time) ?? { long: 0, short: 0 };
      row[event.side] += event.usd;
      liqByTime.set(time, row);
    }
    const ratioPoints = [...ratio].sort((a, b) => a.time - b.time);
    let r = -1;
    const bars = [];
    for (const candle of price.candles ?? []) {
      const end = nextBucket(timeframe, candle.time);
      while (r + 1 < ratioPoints.length && ratioPoints[r + 1].time < end) r++;
      const reading = ratioPoints[r];
      const oiBar = oiByTime.get(candle.time), flowBar = cvdByTime.get(candle.time), liq = liqByTime.get(candle.time);
      bars.push({
        time: candle.time,
        price: { open: candle.open, high: candle.high, low: candle.low, close: candle.close },
        oi: oiBar ? { high: oiBar.high, low: oiBar.low, close: oiBar.close } : null,
        cvd: flowBar ? { open: flowBar.open, high: flowBar.high, low: flowBar.low, close: flowBar.close, buy: flowBar.buyValue, sell: flowBar.sellValue } : null,
        liqLongUsd: liq?.long ?? 0, liqShortUsd: liq?.short ?? 0,
        // Ratio as of the end of the candle (at most one day old).
        lsr: reading && end - reading.time <= 86400 + (end - candle.time) ? reading.ratio : null,
      });
    }
    // Totals: daily perpetual volume (USD, all recorded exchanges) and its 20-day average.
    const days = (daily?.candles ?? []).map(day => (day.buyValue ?? 0) + (day.sellValue ?? 0));
    const completed = days.slice(0, -1).slice(-20);
    const lastClose = price.candles?.at(-1)?.close ?? null;
    return {
      asset, timeframe, exchange: query.exchange, symbol: query.symbol, bars: bars.slice(-1500),
      totals: {
        oiCoin: oi.current?.oiCoin ?? null,
        oiUsd: oi.current?.oiCoin && lastClose ? oi.current.oiCoin * lastClose : null,
        dailyVolumeUsd: days.length ? days.at(-1) : null,
        average20dVolumeUsd: completed.length ? completed.reduce((a, b) => a + b, 0) / completed.length : null,
      },
      generatedAt: new Date(now()).toISOString(),
    };
  }
  return { get };
}
