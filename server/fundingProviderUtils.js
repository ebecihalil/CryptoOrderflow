import { fundingReading, number } from "./fundingMath.js";
import { isExchangeCooldown } from "./exchangeHttpClient.js";

export { fundingReading as reading, number as n };
export const paused = isExchangeCooldown;
export const array = (value, description) => {
    if (!Array.isArray(value)) throw new Error(`Invalid ${description} response`);
    return value;
};
export async function mapConcurrent(items, work, concurrency = 3) {
    let index = 0;
    let failure = null;
    const result = new Array(items.length);
    await Promise.all(Array.from({length: Math.min(concurrency,items.length)},async()=>{
        while(index<items.length&&!failure){const i=index++;try{result[i]=await work(items[i],i);}catch(error){failure=error;}}
    }));
    if(failure)throw failure;
    return result;
}
export function publish(readings, onUpdate) { onUpdate(readings.filter(Boolean)); }
export function intervalFromTimes(first, next, divisor = 3600_000) {
    const a=number(first),b=number(next);
    return a!==null&&b>a?(b-a)/divisor:null;
}
export const stableQuote = quote => ["USD","USDT","USDC"].includes(quote);
