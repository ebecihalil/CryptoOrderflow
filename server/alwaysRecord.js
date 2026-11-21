// Top coins whose order flow and open interest are recorded all the time, so their
// history has no gaps even when nobody has them open. Override with ALWAYS_RECORD=BTC,ETH,...
// Recording busy coins 24/7 needs a real server (e.g. Ampere 4 OCPU); on a 1 GB server set ALWAYS_RECORD= (empty).
export const ALWAYS_RECORD = (process.env.ALWAYS_RECORD ?? "BTC,ETH,SOL,XRP,DOGE")
  .split(",").map(item => item.trim().toUpperCase()).filter(Boolean).slice(0, 10);
