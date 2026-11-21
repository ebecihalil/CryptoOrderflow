// Top coins whose order flow and open interest are recorded all the time, so their
// history has no gaps even when nobody has them open. Override with ALWAYS_RECORD=BTC,ETH,...
export const ALWAYS_RECORD = (process.env.ALWAYS_RECORD ?? "BTC,ETH,SOL,XRP,DOGE")
  .split(",").map(item => item.trim().toUpperCase()).filter(Boolean).slice(0, 10);
