export function nearestWeek(dates, date) {
 const t=Date.parse(date+'T12:00:00Z');
 if(!Number.isFinite(t)||!dates.length)return 0;
 let index=0,best=Infinity;
 dates.forEach((d,i)=>{const gap=Math.abs(Date.parse(d+'T12:00:00Z')-t);if(gap<best){best=gap;index=i;}});
 return index;
}
export async function loadMarkets(){
 const response=await fetch('/markets.json');
 const manifest=response.ok&&response.headers.get('content-type')?.includes('json')?await response.json():{default:'us',markets:[{id:'us',name:'United States',short:'US',world:'/world.json',stress:'/stress.json',tours:'/tours.json'}]};
 const requested=new URLSearchParams(location.search).get('market')||manifest.default;
 const active=manifest.markets.find(m=>m.id===requested)||manifest.markets.find(m=>m.id===manifest.default)||manifest.markets[0];
 const entries=await Promise.all(manifest.markets.map(async m=>{
  const r=await fetch(m.world);if(!r.ok)throw new Error('Unable to load '+m.name+' market data');
  return [m.id,await r.json()];
 }));
 const worlds=Object.fromEntries(entries);
 const r=await fetch(active.stress); const stress=r.ok&&r.headers.get('content-type')?.includes('json')?await r.json():null;
 return {manifest,active,worlds,world:worlds[active.id],stress};
}
