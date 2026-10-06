import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../dashboard/dist/app.js',import.meta.url),'utf8');
const functions=['monthLabel','periodSelection','periodPresets','periodRangeLabel','comparisonPeriods','matches','months','sum','groups','decimal','money','positiveTicket','monthlyCsv'];
const helpers=functions.map(name=>{const line=source.split(/\r?\n/).find(row=>row.startsWith('function '+name+'('));assert.ok(line,name);return line;}).join('\n');
const client=vm.runInNewContext(helpers+'\n({periodSelection,periodPresets,comparisonPeriods})');
const keys=Array.from({length:19},(_,i)=>`${2025+Math.floor(i/12)}-${String(i%12+1).padStart(2,'0')}`);
const plain=value=>JSON.parse(JSON.stringify(value));

test('custom period includes both boundaries, supports one month and refuses invalid or out-of-coverage ranges',()=>{
  const chosen=plain(client.periodSelection('range:2026-03:2026-05',keys));
  assert.deepEqual(chosen.months,['2026-03','2026-04','2026-05']);
  assert.equal(client.periodSelection('range:2026-07:2026-07',keys).months.length,1);
  for(const value of ['range:2026-05:2026-03','range:2024-12:2026-01','range:2026-06:2026-08','range:2026-00:2026-05','range:2026-01:2026-13','invalid','2024'])assert.equal(client.periodSelection(value,keys),null,value);
});
test('year presets show actual coverage and never call a partial year complete',()=>{
  const presets=plain(client.periodPresets(keys));
  assert.equal(presets.length,4);
  const current=presets.find(p=>p.value==='2026');
  assert.equal(current.months.length,7);assert.ok(!current.label.includes('completo'));
  assert.equal(presets.find(p=>p.value==='2025').months.length,12);
  assert.equal(presets.find(p=>p.value.startsWith('range:')).months.length,7);
  assert.equal(client.periodPresets(['2026-07']).length,1);
});
test('comparison follows selected months and requires a complete equivalent window in the previous year',()=>{
  assert.deepEqual(plain(client.comparisonPeriods(keys,'range:2026-03:2026-05')),{current:['2026-03','2026-04','2026-05'],previous:['2025-03','2025-04','2025-05']});
  assert.equal(client.comparisonPeriods(keys,'2025'),null);
  assert.equal(client.comparisonPeriods(keys.filter(m=>m!=='2025-04'),'range:2026-03:2026-05'),null);
  assert.equal(client.comparisonPeriods(keys,'range:2025-01:2026-07'),null);
  assert.equal(client.comparisonPeriods(keys,'all').current.length,7);
});
test('selected monthly universe reconciles metrics, channel/product rankings and CSV without losing negative or zero lines',()=>{
  let value='range:2026-01:2026-02';
  const row=(count,positiveCount,negativeCount,zeroCount,signedCents,positiveCents,negativeCents)=>({count,positiveCount,negativeCount,zeroCount,signedCents,positiveCents,negativeCents,zeroCents:'0'});
  const a=row(2,1,1,0,'50','100','-50'),b=row(2,1,0,1,'300','300','0'),c=row(1,1,0,0,'999','999','0');
  const data={views:{b2c:{series:{month:{'2026-01':a,'2026-02':b,'2026-03':c},monthChannel:{'2026-01':{A:a},'2026-02':{B:b},'2026-03':{A:c}},monthProduct:{'2026-01':{P:a},'2026-02':{P:b},'2026-03':{Q:c}}}}}};
  const context={data,$:()=>({value})};
  const result=vm.runInNewContext(helpers+'\n(()=>{const entries=months();return {metrics:sum(entries.map(([,x])=>x)),channels:groups("channel"),products:groups("product"),csv:monthlyCsv(entries)};})()',context);
  assert.equal(result.metrics.signedCents,350n);assert.equal(result.metrics.count,4);
  assert.equal(result.metrics.negativeCount,1);assert.equal(result.metrics.zeroCount,1);
  assert.equal(Object.values(result.channels).reduce((n,r)=>n+r.signedCents,0n),350n);
  assert.equal(result.products.P.signedCents,350n);assert.ok(!result.products.Q);
  assert.equal(result.csv.split('\r\n').length,3);assert.ok(!result.csv.includes('2026-03'));
  assert.ok(result.csv.includes('"2026-01";"0,50";"1";"1,00";"1,00"'));
});
