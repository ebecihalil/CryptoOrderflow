import { number } from "./fundingMath.js";

const HOUR=3600_000;
const query=(base,params)=>`${base}?${new URLSearchParams(Object.entries(params).filter(([,v])=>v!==undefined))}`;
const point=(timestamp,rate)=>({timestamp:typeof timestamp==="string"&&!/^\d+$/.test(timestamp)?Date.parse(timestamp):Number(timestamp),ratePct:number(rate)===null?null:Number(rate)*100});

// Actual SETTLED payments. Never multiply today's quote by a historical duration.
export async function fetchFundingHistory(request,item,from,to) {
    const points=[],exchange=item.exchange;
    if(["lighter","paradex","coinex","bitmex"].includes(exchange))
        return{from,to,complete:false,points,note:"Settled funding history/basis is not verified for this venue"};
    if(exchange==="okx"&&to-from>90*24*HOUR)
        return{from,to,complete:false,points,note:"OKX public funding history is limited to the last three months"};
    let cursor=to,forward=from+1,previousCursor=null;
    for(let page=1;page<=128;page++){
        let rows,parsed,limit=200,bounded=false;
        switch(exchange){
            case"binance":case"aster":{
                limit=1000;bounded=true;
                const market=exchange==="binance"&&item.symbol.endsWith("_PERP")?"dapi":"fapi";
                const host=exchange==="binance"?`https://${market}.binance.com`:"https://fapi.asterdex.com";
                rows=await request(query(`${host}/${market}/v1/fundingRate`,{symbol:item.symbol,startTime:forward,endTime:to,limit}));
                parsed=rows.map(x=>point(x.fundingTime,x.fundingRate));break;
            }
            case"bybit":{
                bounded=true;
                const body=await request(query("https://api.bybit.com/v5/market/funding/history",{category:item.symbol.endsWith("USD")?"inverse":"linear",symbol:item.symbol,startTime:from+1,endTime:cursor,limit}));
                rows=body.result?.list;parsed=rows.map(x=>point(x.fundingRateTimestamp,x.fundingRate));break;
            }
            case"okx":{
                limit=100;const body=await request(query("https://www.okx.com/api/v5/public/funding-rate-history",{instId:item.symbol,after:cursor,limit}));
                rows=body.data;parsed=rows.map(x=>point(x.fundingTime,x.realizedRate));break;
            }
            case"gate":{
                limit=1000;bounded=true;
                const settle=item.symbol.endsWith("_USD")?"btc":"usdt";
                rows=await request(query(`https://api.gateio.ws/api/v4/futures/${settle}/funding_rate`,{contract:item.symbol,from:Math.floor((from+1)/1000),to:Math.floor(cursor/1000),limit}));
                parsed=rows.map(x=>point(Number(x.t)*1000,x.r));break;
            }
            case"bitget":{
                limit=100;const product=item.symbol.endsWith("USDC")?"USDC-FUTURES":item.symbol.endsWith("USDT")?"USDT-FUTURES":"COIN-FUTURES";
                const body=await request(query("https://api.bitget.com/api/v2/mix/market/history-fund-rate",{symbol:item.symbol,productType:product,pageSize:limit,pageNo:page}));
                rows=body.data;parsed=rows.map(x=>point(x.fundingTime,x.fundingRate));break;
            }
            case"mexc":{
                limit=1000;const body=await request(query("https://contract.mexc.com/api/v1/contract/funding_rate/history",{symbol:item.symbol,page_num:page,page_size:limit}));
                rows=body.data?.resultList;parsed=rows.map(x=>point(x.settleTime,x.fundingRate));break;
            }
            case"kucoin":{
                limit=100;bounded=true;
                const body=await request(query("https://api-futures.kucoin.com/api/v1/contract/funding-rates",{symbol:item.symbol,from:from+1,to:cursor,maxCount:limit}));
                rows=body.data;parsed=rows.map(x=>point(x.timepoint,x.fundingRate));break;
            }
            case"kraken":{
                const body=await request(query("https://futures.kraken.com/derivatives/api/v3/historical-funding-rates",{symbol:item.symbol}));
                rows=body.rates;parsed=rows.map(x=>point(x.timestamp,x.relativeFundingRate));limit=Number.MAX_SAFE_INTEGER;break;
            }
            case"bingx":{
                bounded=true;limit=1000;
                const body=await request(query("https://open-api.bingx.com/openApi/swap/v2/quote/fundingRate",{symbol:item.symbol,startTime:from+1,endTime:cursor,limit}));
                rows=body.data;parsed=rows.map(x=>point(x.fundingTime,x.fundingRate));break;
            }
            case"hyperliquid":{
                bounded=true;limit=500;
                rows=await request("https://api.hyperliquid.xyz/info",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:"fundingHistory",coin:item.symbol,startTime:forward,endTime:to})});
                parsed=rows.map(x=>point(x.time,x.fundingRate));break;
            }
            case"htx":{
                limit=50;const body=await request(query("https://api.hbdm.com/linear-swap-api/v1/swap_historical_funding_rate",{contract_code:item.symbol,page_index:page,page_size:limit}));
                rows=body.data?.data;parsed=rows.map(x=>point(x.funding_time,x.realized_rate??x.funding_rate));break;
            }
            case"deribit":{
                // Deribit settles continuously: interest_1h is the actual hourly payment.
                bounded=true;limit=Number.MAX_SAFE_INTEGER;
                const body=await request(query("https://www.deribit.com/api/v2/public/get_funding_rate_history",{instrument_name:item.symbol,start_timestamp:from+1,end_timestamp:to}));
                rows=body.result;parsed=rows.map(x=>point(x.timestamp,x.interest_1h));break;
            }
            default:return{from,to,complete:false,points,note:"Historical API is not supported"};
        }
        if(!Array.isArray(rows))throw new Error(`Invalid ${exchange} settled history`);
        if(parsed.some(x=>!Number.isFinite(x.timestamp)||x.ratePct===null))
            return{from,to,complete:false,points,note:"Exchange returned incomplete settled-payment records"};
        points.push(...parsed.filter(x=>x.timestamp>from&&x.timestamp<=to));
        const oldest=Math.min(...parsed.map(x=>x.timestamp));
        if(oldest<=from||rows.length<limit){
            const complete=bounded||oldest<=from||(item.listedAt!==null&&item.listedAt>=from);
            if(["kraken","deribit"].includes(exchange)){
                const start=Math.max(from,item.listedAt??from);
                const hours=Math.floor((to-start)/HOUR);
                const unique=new Set(points.map(x=>x.timestamp));
                if(unique.size<hours)return{from,to,complete:false,points,note:"Hourly settled history is incomplete or truncated for this window"};
            }
            return{from,to,complete,points,note:complete?null:"Exchange history does not cover the beginning of this window"};
        }
        if(["binance","aster","hyperliquid"].includes(exchange)){
            const next=Math.max(...parsed.map(x=>x.timestamp))+1;
            if(next>to)return{from,to,complete:true,points,note:null};
            if(next<=forward)break;forward=next;
        }else{
            const next=oldest-1;if(next===previousCursor||next>=cursor)break;
            previousCursor=cursor;cursor=next;
        }
    }
    return{from,to,complete:false,points,note:"Complete history could not be paginated safely"};
}
