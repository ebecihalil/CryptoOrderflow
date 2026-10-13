import { array, reading, n, publish, mapConcurrent, intervalFromTimes, stableQuote, paused } from "./fundingProviderUtils.js";

export async function binance(request, update) {
    const records=[];
    for(const market of ["fapi","dapi"]){
    const base = `https://${market}.binance.com`;
    const [info, rates, settings] = await Promise.all([
        request(`${base}/${market}/v1/exchangeInfo`), request(`${base}/${market}/v1/premiumIndex`), request(`${base}/${market}/v1/fundingInfo`),
    ]);
    const quotes = new Map(array(rates,"Binance funding").map(x=>[x.symbol,x]));
    const intervals = new Map(array(settings,"Binance intervals").map(x=>[x.symbol,n(x.fundingIntervalHours)]));
    await mapConcurrent(array(info.symbols,"Binance instruments").filter(x=>x.status==="TRADING"&&x.contractType==="PERPETUAL"&&stableQuote(x.quoteAsset)),async x=>{
        try {
            const oi=await request(`${base}/${market}/v1/openInterest?symbol=${encodeURIComponent(x.symbol)}`);
            const q=quotes.get(x.symbol);
            // Binance fundingInfo lists adjusted contracts; 8h is its documented default.
            const usd=market==="dapi"?n(oi.openInterest)*n(x.contractSize):n(oi.openInterest)*n(q?.markPrice);
            const item=reading("binance",x.symbol,x.baseAsset,usd,q?.lastFundingRate,intervals.get(x.symbol)??8,x.onboardDate);
            if(item){records.push(item);publish(records,update);}
        }catch(error){if(paused(error))throw error;}
    },4);
    }
    return records;
}
export async function bybit(request, update) {
    const records=[];
    for(const category of ["linear","inverse"]){
        const body=await request(`https://api.bybit.com/v5/market/tickers?category=${category}`);
        for(const q of array(body.result?.list,"Bybit tickers")){
            if(!q.symbol.endsWith("USDT")&&!q.symbol.endsWith("USDC")&&!q.symbol.endsWith("USD"))continue;
            // New Bybit fields explicitly distinguish single-sided from both-sided OI.
            const oi=category==="inverse"
                ? n(q.singleOpenInterest)??(n(q.openInterest)!==null?n(q.openInterest)/2:null)
                : n(q.singleOpenInterestValue)??(n(q.openInterestValue)!==null?n(q.openInterestValue)/2:null);
            records.push(reading("bybit",q.symbol,q.symbol.replace(/(USDT|USDC|USD)$/,""),oi,q.fundingRate,q.fundingIntervalHour));
        }
    }
    publish(records,update);return records.filter(Boolean);
}
export async function okx(request, update) {
    const [info,oi]=await Promise.all([request("https://www.okx.com/api/v5/public/instruments?instType=SWAP"),request("https://www.okx.com/api/v5/public/open-interest?instType=SWAP")]);
    const interests=new Map(array(oi.data,"OKX OI").map(x=>[x.instId,x]));
    const records=array(info.data,"OKX swaps").filter(x=>x.state==="live"&&stableQuote(x.settleCcy)).map(x=>reading("okx",x.instId,x.ctValCcy,n(interests.get(x.instId)?.oiUsd),null,null,x.listTime)).filter(Boolean);
    publish(records,update);
    await mapConcurrent(records,async item=>{
        try{const q=(await request(`https://www.okx.com/api/v5/public/funding-rate?instId=${encodeURIComponent(item.symbol)}`)).data?.[0];
            item.ratePct=n(q?.fundingRate)!==null?n(q.fundingRate)*100:null;
            item.intervalHours=intervalFromTimes(q?.fundingTime,q?.nextFundingTime);publish(records,update);
        }catch(error){if(paused(error))throw error;}
    });
    return records;
}
export async function gate(request, update) {
    const records=[];
    for(const settle of ["usdt","btc"]){
        const contracts=await request(`https://api.gateio.ws/api/v4/futures/${settle}/contracts`);
        for(const x of array(contracts,"Gate contracts").filter(x=>!x.in_delisting&&x.status!=="delisted")){
            const oi=settle==="btc"?n(x.position_size)*n(x.quanto_multiplier):n(x.position_size)*n(x.quanto_multiplier)*n(x.mark_price);
            records.push(reading("gate",x.name,x.name.split("_")[0],oi,x.funding_rate,n(x.funding_interval)/3600,n(x.create_time)*1000));
        }
        publish(records,update);
    }
    publish(records,update);return records.filter(Boolean);
}
export async function bitget(request, update) {
    const records=[];
    for(const product of ["USDT-FUTURES","USDC-FUTURES","COIN-FUTURES"]){
        const [tickers,settings]=await Promise.all([
            request(`https://api.bitget.com/api/v2/mix/market/tickers?productType=${product}`),
            request(`https://api.bitget.com/api/v2/mix/market/current-fund-rate?productType=${product}`),
        ]);
        const periods=new Map(array(settings.data,"Bitget funding intervals").map(x=>[x.symbol,n(x.fundingRateInterval)]));
        for(const x of array(tickers.data,"Bitget tickers"))records.push(reading("bitget",x.symbol,x.symbol.replace(/(USDT|USDC|USD)$/,""),
            n(x.holdingAmount)*n(x.markPrice),x.fundingRate,periods.get(x.symbol)));
    }
    publish(records,update);return records.filter(Boolean);
}
export async function mexc(request, update) {
    const [info,tickers]=await Promise.all([request("https://contract.mexc.com/api/v1/contract/detail"),request("https://contract.mexc.com/api/v1/contract/ticker")]);
    const metadata=new Map(array(info.data,"MEXC metadata").filter(x=>x.state===0&&stableQuote(x.quoteCoin)).map(x=>[x.symbol,x]));
    const records=array(tickers.data,"MEXC tickers").filter(x=>metadata.has(x.symbol)).map(x=>{
        const m=metadata.get(x.symbol);
        const oi=m.quoteCoin==="USD"?n(x.holdVol)*n(m.contractSize):n(x.holdVol)*n(m.contractSize)*n(x.fairPrice);
        return reading("mexc",x.symbol,m.baseCoin,oi,x.fundingRate,null,m.createTime);
    }).filter(Boolean);
    publish(records,update);
    await mapConcurrent(records,async item=>{
        try{const q=(await request(`https://contract.mexc.com/api/v1/contract/funding_rate/${encodeURIComponent(item.symbol)}`)).data;
            item.intervalHours=n(q?.collectCycle);item.ratePct=n(q?.fundingRate)!==null?n(q.fundingRate)*100:null;publish(records,update);
        }catch(error){if(paused(error))throw error;}
    },3);
    return records;
}
export async function kucoin(request, update) {
    const body=await request("https://api-futures.kucoin.com/api/v1/contracts/active");
    const records=array(body.data,"KuCoin contracts").filter(x=>x.status==="Open"&&x.expireDate===null&&stableQuote(x.quoteCurrency)).map(x=>
        reading("kucoin",x.symbol,x.baseCurrency,x.isInverse?n(x.openInterest)*Math.abs(n(x.multiplier)):n(x.openInterest)*Math.abs(n(x.multiplier))*n(x.markPrice),
            x.fundingFeeRate,n(x.currentFundingRateGranularity??x.fundingRateGranularity)/3600_000,x.firstOpenDate)).filter(Boolean);
    publish(records,update);return records;
}
export async function kraken(request, update) {
    const body=await request("https://futures.kraken.com/derivatives/api/v3/tickers");
    const records=array(body.tickers,"Kraken tickers").filter(x=>x.tag==="perpetual"&&!x.suspended).map(x=>
        reading("kraken",x.symbol,x.pair.split(":")[0],x.symbol.startsWith("PI_")?n(x.openInterest):n(x.openInterest)*n(x.markPrice),
            x.relativeFundingRate,1)).filter(Boolean);
    publish(records,update);return records;
}
export async function bingx(request, update) {
    const body=await request("https://open-api.bingx.com/openApi/swap/v2/quote/premiumIndex");
    const records=[];
    await mapConcurrent(array(body.data,"BingX quotes"),async q=>{
        try{const oi=await request(`https://open-api.bingx.com/openApi/swap/v2/quote/openInterest?symbol=${encodeURIComponent(q.symbol)}`);
            // BingX documents this field as the contract's open-interest USD value.
            const item=reading("bingx",q.symbol,q.symbol.split("-")[0],oi.data?.openInterest,q.lastFundingRate,q.fundingIntervalHours);
            if(item){records.push(item);publish(records,update);}
        }catch(error){if(paused(error))throw error;}
    },3);return records;
}
export async function aster(request, update) {
    const [info,quotes,settings]=await Promise.all([
        request("https://fapi.asterdex.com/fapi/v1/exchangeInfo"),request("https://fapi.asterdex.com/fapi/v1/premiumIndex"),request("https://fapi.asterdex.com/fapi/v1/fundingInfo"),
    ]);
    const rates=new Map(array(quotes,"Aster quotes").map(x=>[x.symbol,x]));
    const periods=new Map(array(settings,"Aster intervals").map(x=>[x.symbol,n(x.fundingIntervalHours)]));
    const records=[];
    await mapConcurrent(array(info.symbols,"Aster contracts").filter(x=>x.status==="TRADING"&&x.contractType==="PERPETUAL"&&stableQuote(x.quoteAsset)),async x=>{
        try{const oi=await request(`https://fapi.asterdex.com/fapi/v1/openInterest?symbol=${encodeURIComponent(x.symbol)}`);
            const q=rates.get(x.symbol);const item=reading("aster",x.symbol,x.baseAsset,n(oi.openInterest)*n(q?.markPrice),q?.lastFundingRate,periods.get(x.symbol),x.onboardDate);
            if(item){records.push(item);publish(records,update);}
        }catch(error){if(paused(error))throw error;}
    },3);return records;
}
