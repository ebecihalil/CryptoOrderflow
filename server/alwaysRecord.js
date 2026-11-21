// Top coins whose order flow and open interest are recorded all the time, so their
// history has no gaps even when nobody has them open. Override with ALWAYS_RECORD=BTC,ETH,...
// Off by default: recording busy coins 24/7 needs a bigger server than the 1 GB free one.
export const ALWAYS_RECORD = (process.env.ALWAYS_RECORD ?? "")
  .split(",").map(item => item.trim().toUpperCase()).filter(Boolean).slice(0, 10);
