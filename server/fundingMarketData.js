import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { requestGates, requestJson } from "./exchangeRequests.js";
import * as major from "./fundingProviders.js";
import * as extra from "./fundingProvidersExtra.js";
import { FUNDING_WINDOWS, buildFundingSnapshot, compactHistory } from "./fundingMath.js";
import { fetchFundingHistory } from "./fundingHistory.js";

const providers={...major,...extra};
const states=Object.fromEntries(Object.keys(providers).map(exchange=>[exchange,{
    readings:[],status:"connecting",updatedAt:null,error:null,lastAttempt:0,running:false,
}]));
const directory=fileURLToPath(new URL("../.cache/funding-history/",import.meta.url));
const histories=new Map(),loaded=new Set(),pending=new Set(),historyActive=new Map(),historyAttempts=new Map();
function cacheFile(key){return join(directory,`${encodeURIComponent(key)}.json`);}
function loadHistory(key){
    if(loaded.has(key))return;
    loaded.add(key);
    try{
        const entry=JSON.parse(readFileSync(cacheFile(key),"utf8"));
        if(Number.isFinite(entry.from)&&Number.isFinite(entry.to)&&Array.isArray(entry.points))histories.set(key,compactHistory(entry));
    }catch(error){if(error.code!=="ENOENT")console.warn("Funding history cache could not be loaded:",error.message);}
}
function persistHistory(key,entry){
    mkdirSync(directory,{recursive:true});const file=cacheFile(key);
    writeFileSync(`${file}.tmp`,JSON.stringify(entry));renameSync(`${file}.tmp`,file);
}
function collect(exchange){
    const state=states[exchange],gate=requestGates[exchange],now=Date.now();
    if(state.running||now-state.lastAttempt<300_000)return;
    if(gate.isCoolingDown){
        state.status=state.readings.length?"delayed":"error";state.error=`${stateLabel(exchange)} requests paused by exchange cooldown`;return;
    }
    state.running=true;state.lastAttempt=now;state.status="refreshing";
    const retained=new Map(state.readings.map(item=>[item.symbol,item]));
    providers[exchange](requestJson,readings=>{
        for(const item of readings)retained.set(item.symbol,item);
        state.readings=[...retained.values()];state.updatedAt=new Date().toISOString();
    })
        .then(readings=>{
            if(!readings.length)throw new Error("No usable perpetual open-interest inventory returned");
            state.readings=readings;state.updatedAt=new Date().toISOString();
            state.status=readings.some(x=>x.ratePct===null||x.intervalHours===null)?"delayed":"live";
            state.error=state.status==="delayed"?"Some quotes or funding intervals could not be verified":null;
        }).catch(error=>{state.status=state.readings.length?"delayed":"error";state.error=error.message;})
        .finally(()=>{state.running=false;});
}
function stateLabel(exchange){return exchange[0].toUpperCase()+exchange.slice(1);}
// Shared inventory: Open Interest must not launch a second OI scan for the same venues.
export function getPerpetualInventory() {
    for (const exchange of Object.keys(providers)) collect(exchange);
    return states;
}
function queueHistory(item,timeframe,end){
    const key=`${item.exchange}:${item.symbol}`;
    loadHistory(key);
    const entry=histories.get(key),from=end-FUNDING_WINDOWS[timeframe],now=Date.now();
    if(entry?.complete&&entry.from<=from&&entry.to>=end)return;
    const attempted=historyAttempts.get(key);
    if(pending.has(key)||(historyActive.get(item.exchange)??0)>=2||
        (attempted?.from===from&&attempted?.end===end&&now-attempted.time<300_000))return;
    if(requestGates[item.exchange].isCoolingDown)return;
    pending.add(key);historyActive.set(item.exchange,(historyActive.get(item.exchange)??0)+1);historyAttempts.set(key,{time:now,from,end});
    // Reuse verified cached payments and fetch only the new/previously absent range.
    let old=null;
    if(entry?.complete){try{old=JSON.parse(readFileSync(cacheFile(key),"utf8"));}catch{}}
    const fetchFrom=old&&old.from<=from?old.to:from;
    fetchFundingHistory(requestJson,item,fetchFrom,end).then(result=>{
        let merged=result;
        if(old&&old.from<=from&&result.complete){
            const byTime=new Map([...old.points,...result.points].map(point=>[point.timestamp,point]));
            merged={...result,from:old.from,points:[...byTime.values()].filter(point=>point.timestamp>end-365*86400_000)};
            // Evicted older payments must never leave a false earlier coverage claim.
            merged.from=Math.max(old.from,end-365*86400_000);
        }
        histories.set(key,compactHistory(merged));persistHistory(key,merged);
    }).catch(error=>{histories.set(key,{from,to:end,complete:false,points:[],note:error.message});})
        .finally(()=>{pending.delete(key);historyActive.set(item.exchange,(historyActive.get(item.exchange)??1)-1);});
}
export function getFundingMarketSnapshot(timeframe="current"){
    if(!(timeframe in FUNDING_WINDOWS))throw new Error("Invalid funding timeframe");
    for(const exchange of Object.keys(providers))collect(exchange);
    const now=Date.now(),end=Math.floor(now/3600_000)*3600_000;
    let snapshot=buildFundingSnapshot(states,histories,timeframe,now);
    if(timeframe!=="current"){
        const eligible=new Set(snapshot.sources.filter(source=>source.eligible).map(source=>source.exchange));
        const readings=Object.values(states).flatMap(state=>state.readings).filter(item=>eligible.has(item.exchange))
            .sort((a,b)=>(["BTC","ETH","SOL","HYPE"].includes(b.asset)?1:0)-(["BTC","ETH","SOL","HYPE"].includes(a.asset)?1:0)||b.oiUsd-a.oiUsd);
        for(const item of readings)queueHistory(item,timeframe,end);
        // Loading persisted history may have supplied data during this pass.
        snapshot=buildFundingSnapshot(states,histories,timeframe,now);
    }
    return{...snapshot,isRefreshing:snapshot.isRefreshing||pending.size>0};
}
