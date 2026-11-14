(function(root){
"use strict";
function nearestDateIndex(value,dates){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return -1;
 const t=Date.parse(value+"T12:00:00Z");
 if(!Number.isFinite(t)||new Date(t).toISOString().slice(0,10)!==value)return -1;
 let best=-1,distance=Infinity;
 dates.forEach((date,i)=>{const d=Math.abs(Date.parse(date+"T12:00:00Z")-t);if(d<distance){best=i;distance=d;}});
 return best;
}
root.MarketDates={nearestDateIndex};
})(typeof window!=="undefined"?window:globalThis);
