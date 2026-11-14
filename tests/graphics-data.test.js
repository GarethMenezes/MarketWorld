import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOceanPalette} from '../ocean-palette.js';
import {nearestWeek} from '../market-catalog.js';
test('ocean palette preserves shallow and deep reference colours with opaque alpha',()=>{
 const p=buildOceanPalette(512);
 assert.deepEqual([...p.slice(0,4)],[169,220,240,255]);
 assert.deepEqual([...p.slice(-4)],[14,51,88,255]);
 for(let i=4;i<p.length;i+=4){assert.equal(p[i+3],255);for(let c=0;c<3;c++)assert.ok(p[i+c]<=p[i-4+c]);}
});
test('regional dates choose the nearest available week and clamp outside coverage',()=>{
 const dates=['2020-03-06','2020-03-13','2020-03-20'];
 assert.equal(nearestWeek(dates,'2020-03-12'),1);
 assert.equal(nearestWeek(dates,'2020-03-15'),1);
 assert.equal(nearestWeek(dates,'2020-03-20'),2);
 assert.equal(nearestWeek(dates,'2000-01-01'),0);
 assert.equal(nearestWeek(dates,'2030-01-01'),2);
});
