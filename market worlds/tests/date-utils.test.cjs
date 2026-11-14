const {test}=require('node:test');
const assert=require('node:assert/strict');
require('../dist/date-utils.js');
const nearest=globalThis.MarketDates.nearestDateIndex;
const dates=['2008-09-15','2020-03-23','2020-11-09'];
test('exact and nearest historical dates',()=>{
 assert.equal(nearest('2020-11-09',dates),2);
 assert.equal(nearest('2020-11-10',dates),2);
 assert.equal(nearest('2020-02-29',dates),1);
 assert.equal(nearest('1900-01-01',dates),0);
 assert.equal(nearest('2099-01-01',dates),2);
});
test('reject impossible or malformed calendar dates',()=>{
 for(const value of ['2021-02-29','2020-02-30','2020-13-01','', 'hello','20-01-01']) assert.equal(nearest(value,dates),-1);
});
test('ties select earlier ordered chapter; empty catalogue returns -1',()=>{
 assert.equal(nearest('2020-01-02',['2020-01-01','2020-01-03']),0);
 assert.equal(nearest('2020-01-02',[]),-1);
});
