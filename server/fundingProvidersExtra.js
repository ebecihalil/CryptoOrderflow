import { array, reading, n, publish } from "./fundingProviderUtils.js";

export async function hyperliquid(request, update) {
    const body=await request("https://api.hyperliquid.xyz/info",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:"metaAndAssetCtxs"})});
    if(!Array.isArray(body)||!Array.isArray(body[0]?.universe)||!Array.isArray(body[1]))throw new Error("Invalid Hyperliquid asset contexts");
    const records=body[0].universe.map((x,i)=>x.isDelisted?null:reading("hyperliquid",x.name,x.name,n(body[1][i]?.openInterest)*n(body[1][i]?.markPx),body[1][i]?.funding,1,null,
        {markPrice:body[1][i]?.markPx,volume24hUsd:body[1][i]?.dayNtlVlm})).filter(Boolean);
    publish(records,update);return records;
}
export async function htx(request, update) {
    const [info,rates,oi]=await Promise.all([
        request("https://api.hbdm.com/linear-swap-api/v1/swap_contract_info"),request("https://api.hbdm.com/linear-swap-api/v1/swap_batch_funding_rate"),
        request("https://api.hbdm.com/linear-swap-api/v1/swap_open_interest"),
    ]);
    const quotes=new Map(array(rates.data,"HTX funding").map(x=>[x.contract_code,x]));
    const interests=new Map(array(oi.data,"HTX OI").map(x=>[x.contract_code,x]));
    const records=array(info.data,"HTX metadata").filter(x=>x.contract_status===1&&x.business_type==="swap").map(x=>
        reading("htx",x.contract_code,x.symbol,interests.get(x.contract_code)?.value,quotes.get(x.contract_code)?.funding_rate,x.settlement_period,null,
            {markPrice:n(interests.get(x.contract_code)?.amount)>0?n(interests.get(x.contract_code)?.value)/n(interests.get(x.contract_code)?.amount):null})).filter(Boolean);
    publish(records,update);return records;
}
export async function deribit(request, update) {
    const records=[];
    for(const currency of ["BTC","ETH","USDC"]){
        const body=await request(`https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${currency}&kind=future`);
        for(const x of array(body.result,"Deribit summaries").filter(x=>x.instrument_name.endsWith("PERPETUAL"))){
            records.push(reading("deribit",x.instrument_name,x.base_currency,x.quote_currency==="USD"?n(x.open_interest):n(x.open_interest)*n(x.mark_price),x.current_funding,8,null,
                {markPrice:x.mark_price,volume24hUsd:x.volume_usd}));
        }
    }
    publish(records,update);return records.filter(Boolean);
}
export async function lighter(request, update) {
    const body=await request("https://mainnet.zklighter.elliot.ai/api/v1/orderBookDetails");
    // Do not count its Binance/Bybit comparison-feed funding rates as Lighter data.
    // OI inventory is usable; quote units/settlement interval remain unverified.
    const records=array(body.order_book_details,"Lighter markets").filter(x=>x.market_type==="perp"&&x.status==="active")
        .map(x=>reading("lighter",String(x.market_id),x.symbol,n(x.open_interest)*n(x.mark_price),null,null,x.created_at,{markPrice:x.mark_price,volume24hUsd:x.daily_quote_token_volume})).filter(Boolean);
    publish(records,update);return records;
}
export async function paradex(request, update) {
    const body=await request("https://api.prod.paradex.trade/v1/markets/summary?market=ALL");
    const records=array(body.results,"Paradex summaries").filter(x=>x.symbol.endsWith("-PERP"))
        .map(x=>reading("paradex",x.symbol,x.symbol.split("-")[0],n(x.open_interest)*n(x.mark_price),null,null,null,{markPrice:x.mark_price,volume24hUsd:x.volume_24h})).filter(Boolean);
    // Its API quote versus hourly settlement basis must be verified before weighting.
    publish(records,update);return records;
}
export async function coinex(request, update) {
    const [markets,rates]=await Promise.all([request("https://api.coinex.com/v2/futures/market"),request("https://api.coinex.com/v2/futures/funding-rate")]);
    const quotes=new Map(array(rates.data,"CoinEx funding").map(x=>[x.market,x]));
    const records=array(markets.data,"CoinEx markets").map(x=>{
        const q=quotes.get(x.market);return reading("coinex",x.market,x.base_ccy,x.open_interest_value,q?.latest_funding_rate,q?.funding_interval);
    }).filter(Boolean);
    if(!records.length)throw new Error("CoinEx public response does not expose usable USD open interest");
    publish(records,update);return records;
}
export async function bitmex(request, update) {
    const body=await request("https://www.bitmex.com/api/v1/instrument/active");
    const records=array(body,"BitMEX instruments").filter(x=>x.state==="Open"&&x.fundingRate!==undefined&&n(x.openValue)>0)
        .map(x=>reading("bitmex",x.symbol,x.underlying,null,x.fundingRate,null)).filter(Boolean);
    if(!records.length)throw new Error("BitMEX instruments lack verified USD open-interest conversion; excluded from weighting");
    publish(records,update);return records;
}
