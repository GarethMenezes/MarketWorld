// Adapted from archimedix/sea-level-explorer app.js, MIT.
// Copyright (c) 2026 Piergiorgio Borgogno. See NOTICES.md.
export const SEA_STOPS = [
 [-11000,3,11,28],[-6000,6,28,54],[-3000,14,51,88],[-1000,27,80,130],
 [-400,39,105,164],[-120,56,135,192],[-40,85,166,214],[-8,130,198,230],[0,169,220,240]
];
// Relative shader depths are illustrative; these palette indices are not metres.
export function buildOceanPalette(size=512) {
 const bytes=new Uint8Array(size*4);
 for(let i=0;i<size;i++){
  const h=-3000*i/(size-1);let j=0;
  while(j<SEA_STOPS.length-2&&h>SEA_STOPS[j+1][0])j++;
  const a=SEA_STOPS[j],b=SEA_STOPS[j+1],t=Math.max(0,Math.min(1,(h-a[0])/(b[0]-a[0])));
  for(let c=0;c<3;c++)bytes[i*4+c]=Math.round(a[c+1]+(b[c+1]-a[c+1])*t);
  bytes[i*4+3]=255;
 }
 return bytes;
}
