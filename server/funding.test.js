import test from "node:test";
import assert from "node:assert/strict";
import { fundingReading, normalizedRate, buildFundingSnapshot, historicalValue, compactHistory } from "./fundingMath.js";
import { fetchFundingHistory } from "./fundingHistory.js";
import { BinanceRequestGate } from "./binanceRequestGate.js";
import { createExchangeHttpClient } from "./exchangeHttpClient.js";
import { ExchangeRequestGate, EXCHANGE_POLICIES } from "./exchangeRequestGate.js";
import { bybit, mexc, kucoin } from "./fundingProviders.js";

const now=1_800_000_000_000,end=Math.floor(now/3600_000)*3600_000;
function r(exchange,asset,oi,rate,hours=8){return {...fundingReading(exchange,`${asset}USDT`,asset,oi,rate,hours),fetchedAt:now};}
function states(readings){return Object.fromEntries([...new Set(readings.map(x=>x.exchange))].map(exchange=>[exchange,{readings:readings.filter(x=>x.exchange===exchange),status:"live",updatedAt:new Date(now).toISOString(),error:null}]));}

test("native funding changes in settlement interval normalize correctly, unknown intervals never become 8h",()=>{
    assert.equal(normalizedRate(0.35,4),0.7);assert.equal(normalizedRate(0.35,1),2.8);
    assert.equal(normalizedRate(-0.1,8),-0.1);assert.equal(normalizedRate(0.2,null),null);
});
test("global 1% OI cutoff is inclusive and NOT a per-coin cutoff",()=>{
    const input=[r("binance","BTC",9890,.0001),r("bybit","PEPE",100,.0002),r("gate","PEPE",10,.003)];
    const result=buildFundingSnapshot(states(input),new Map(),"current",now);
    assert.equal(result.sources.find(x=>x.exchange==="bybit").eligible,true);
    assert.equal(result.sources.find(x=>x.exchange==="gate").eligible,false);
    assert.deepEqual(Object.keys(result.rows.find(x=>x.asset==="PEPE").venues),["bybit"]);
    assert.equal(result.totalOpenInterestUsd,10000);
});
test("OI-weighted aggregate uses normalized rates and resolves majority multiplier names",()=>{
    const input=[r("binance","1000PEPE",100,.001,4),r("bybit","1000PEPE",200,.001,8),r("gate","PEPE",100,.002,8)];
    const result=buildFundingSnapshot(states(input),new Map(),"current",now);
    assert.equal(result.rows.length,1);assert.equal(result.rows[0].displayAsset,"1000PEPE");
    assert.ok(Math.abs(result.rows[0].aggregatePct-.15)<1e-12);
});
test("missing funding intervals keep their inventory OI in the denominator but never contaminate rates",()=>{
    const result=buildFundingSnapshot(states([r("binance","BTC",100,.001),r("bybit","BTC",100,.01,null)]),new Map(),"current",now);
    assert.equal(result.totalOpenInterestUsd,200);assert.equal(result.rows[0].aggregatePct,.1);
    assert.equal(result.rows[0].sourceCount,1);
    assert.equal(result.rows[0].venues.bybit.valuePct,null);
});
test("stale inventories are excluded, and BTC/ETH/SOL/HYPE summaries preserve unavailable data",()=>{
    const old={...r("binance","BTC",100,.001),fetchedAt:now-16*60_000};
    const result=buildFundingSnapshot(states([old,r("bybit","HYPE",100,.002)]),new Map(),"current",now);
    assert.equal(result.totalOpenInterestUsd,100);
    assert.equal(result.highlights.find(x=>x.asset==="BTC").valuePct,null);
    assert.equal(result.highlights.find(x=>x.asset==="HYPE").valuePct,.2);
});
test("settled sums deduplicate payments, exclude start boundary, include end, and reject incomplete history",()=>{
    const entry={from:end-86400_000,to:end,complete:true,points:[
        {timestamp:end-86400_000,ratePct:50},{timestamp:end-1000,ratePct:.1},
        {timestamp:end-1000,ratePct:.1},{timestamp:end,ratePct:-.02},{timestamp:end+1000,ratePct:100},
    ]};
    assert.ok(Math.abs(historicalValue(entry,"1d",end).value-.08)<1e-12);
    assert.equal(historicalValue({...entry,complete:false},"1d",end).value,null);
    assert.equal(historicalValue(entry,"1y",end).value,null);
    const compact=compactHistory(entry);
    assert.equal(compact.points,undefined);assert.ok(Math.abs(historicalValue(compact,"1d",end).value-.08)<1e-12);
});
test("Binance history paginates without duplicate or truncated payments",async()=>{
    const from=end-86400_000,calls=[];
    const request=async url=>{
        const q=new URL(url).searchParams;calls.push(Number(q.get("startTime")));
        return calls.length===1?Array.from({length:1000},(_,i)=>({fundingTime:from+1000+i,fundingRate:.0001})):
            [{fundingTime:end,fundingRate:.0002}];
    };
    const result=await fetchFundingHistory(request,r("binance","BTC",100,.0001),from,end);
    assert.equal(result.complete,true);assert.equal(result.points.length,1001);
    assert.equal(calls[1],from+2000);
});
test("OKX full-year history is explicitly unavailable, without synthetic extrapolation or requests",async()=>{
    const result=await fetchFundingHistory(()=>{throw new Error("must not request");},r("okx","BTC",100,.0001),end-365*86400_000,end);
    assert.equal(result.complete,false);assert.match(result.note,/three months/);assert.equal(result.points.length,0);
});
test("truncated hourly Deribit history must not masquerade as a complete year",async()=>{
    const result=await fetchFundingHistory(async()=>({result:[{timestamp:end,interest_1h:.0001}]}),r("deribit","BTC",100,.0001),end-365*86400_000,end);
    assert.equal(result.complete,false);assert.match(result.note,/incomplete or truncated/);
});
test("Binance fundingRate and fundingInfo share their OWN conservative 350/5min allowance",async()=>{
    let time=now;const starts=[];
    const gate=new BinanceRequestGate({now:()=>time,sleep:async delay=>{time+=delay;},spacingMs:0});
    for(let i=0;i<351;i++){await gate.enter(`https://fapi.binance.com/fapi/v1/${i%2?"fundingRate":"fundingInfo"}`);starts.push(time);}
    assert.ok(starts[350]-starts[0]>=300_000);
    assert.equal(gate.history.length,0);assert.equal(gate.general.length,0);
});
test("shared HTTP client supports public POST and KuCoin/lighter success codes",async()=>{
    const options=[];
    const gates={hyperliquid:{enter:async()=>{},inspect:()=>{},inspectBody:()=>{}},kucoin:{enter:async()=>{},inspect:()=>{},inspectBody:()=>{}}};
    const request=createExchangeHttpClient({gates,fetchImpl:async(url,opts)=>{options.push(opts);return new Response(JSON.stringify(url.includes("kucoin")?{code:"200000",data:[]}:[{},[]]));}});
    await request("https://api.hyperliquid.xyz/info",{method:"POST",body:'{"type":"metaAndAssetCtxs"}'});
    assert.equal(options[0].method,"POST");assert.match(options[0].body,/metaAndAssetCtxs/);
    assert.deepEqual(await request("https://api-futures.kucoin.com/api/v1/contracts/active"),{code:"200000",data:[]});
});
test("Bybit funding weights use documented single-sided USD OI and variable hour intervals",async()=>{
    const result=await bybit(async url=>({result:{list:url.includes("linear")?[{symbol:"BTCUSDT",singleOpenInterestValue:"50",openInterestValue:"100",fundingRate:".001",fundingIntervalHour:"4"}]:[]}}),()=>{});
    assert.equal(result[0].oiUsd,50);assert.equal(result[0].intervalHours,4);
});
test("Bybit inverse OI is already USD contracts, not its base-coin openInterestValue",async()=>{
    const result=await bybit(async url=>({result:{list:url.includes("inverse")?[{symbol:"BTCUSD",singleOpenInterest:"10000",singleOpenInterestValue:".1",fundingRate:".001",fundingIntervalHour:"4"}]:[]}}),()=>{});
    assert.equal(result[0].oiUsd,10000);
});
test("MEXC converts contract counts through contract size and reads collectCycle, not a hardcoded interval",async()=>{
    const result=await mexc(async url=>{
        if(url.endsWith("detail"))return{data:[{symbol:"BTC_USDT",state:0,baseCoin:"BTC",quoteCoin:"USDT",contractSize:.001}]};
        if(url.endsWith("ticker"))return{data:[{symbol:"BTC_USDT",holdVol:100,fairPrice:10000,fundingRate:.001}]};
        return{data:{fundingRate:.002,collectCycle:1}};
    },()=>{});
    assert.equal(result[0].oiUsd,1000);assert.equal(result[0].intervalHours,1);assert.equal(result[0].ratePct,.2);
});
test("KuCoin multiplier-based OI is USD, not raw contract count",async()=>{
    const result=await kucoin(async()=>({data:[{symbol:"XBTUSDTM",baseCurrency:"XBT",quoteCurrency:"USDT",status:"Open",expireDate:null,openInterest:100,multiplier:.001,markPrice:10000,fundingFeeRate:.0001,currentFundingRateGranularity:3600_000}]}),()=>{});
    assert.equal(result[0].asset,"BTC");assert.equal(result[0].oiUsd,1000);assert.equal(result[0].intervalHours,1);
});
test("MEXC inverse contract size is a USD face value and must NOT be multiplied by price",async()=>{
    const result=await mexc(async url=>{
        if(url.endsWith("detail"))return{data:[{symbol:"BTC_USD",state:0,baseCoin:"BTC",quoteCoin:"USD",contractSize:100}]};
        if(url.endsWith("ticker"))return{data:[{symbol:"BTC_USD",holdVol:1000,fairPrice:10000,fundingRate:.001}]};
        return{data:{fundingRate:.001,collectCycle:8}};
    },()=>{});
    assert.equal(result[0].oiUsd,100000);
});
for(const exchange of Object.keys(EXCHANGE_POLICIES).filter(x=>!["bybit","okx","gate","bitget","toobit"].includes(x))){
    test(`${exchange} funding collector remains below every configured rolling request quota`,async()=>{
        let time=now;const starts=[];const gate=new ExchangeRequestGate(exchange,{now:()=>time,sleep:async delay=>{time+=delay;}});
        for(let i=0;i<65;i++){await gate.enter("https://example.com/funding");starts.push(time);}
        for(const rule of EXCHANGE_POLICIES[exchange].rules)
            for(const timestamp of starts)assert.ok(starts.filter(x=>x>timestamp-rule.windowMs&&x<=timestamp).length<=rule.limit);
    });
}
