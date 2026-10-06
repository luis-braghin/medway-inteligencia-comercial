import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../dashboard/dist/app.js',import.meta.url),'utf8');
const summary=vm.runInNewContext(source.slice(source.indexOf('function overviewSummary('),source.indexOf('function recurringTrend('))+'\noverviewSummary');
test('MRR at the end of a selected window is distinct from accumulated recurrence',()=>{
  const records=[{month:'2026-03',b2bSumMonthlyMinorUnits:'24000',combinedAssumedBrlCents:'54000'},{month:'2026-01',b2bSumMonthlyMinorUnits:'10000',combinedAssumedBrlCents:'20000'},{month:'2026-02',b2bSumMonthlyMinorUnits:'15000',combinedAssumedBrlCents:'35000'}];
  const r=summary(records);
  assert.equal(r.last.month,'2026-03');assert.equal(r.last.b2bSumMonthlyMinorUnits,'24000');assert.equal(r.b2b,49000n);assert.equal(r.combined,109000n);
  assert.equal(records[0].month,'2026-03');
  assert.equal(summary(records.filter(r=>r.month<='2026-02')).last.b2bSumMonthlyMinorUnits,'15000');
});
test('absent modeled months remain absent, and a zero month remains a real observation',()=>{
  assert.equal(summary([]).last,null);assert.equal(summary([]).combined,0n);
  const r=summary([{month:'2026-01',b2bSumMonthlyMinorUnits:'0',combinedAssumedBrlCents:'-100'}]);
  assert.equal(r.last.b2bSumMonthlyMinorUnits,'0');assert.equal(r.combined,-100n);
});
const esc=source.split(/\r?\n/).find(l=>l.startsWith('function esc('));
const attrs=source.split(/\r?\n/).find(l=>l.startsWith('function tooltipAttrs('));
const tooltip=vm.runInNewContext(esc+'\n'+attrs+'\ntooltipAttrs');
const arc=vm.runInNewContext(source.slice(source.indexOf('function donutArc('),source.indexOf('function productMix('))+'\ndonutArc');
test('donut percentages occupy the full circumference, including a single-product ring',()=>{
  const half=arc(0,50).match(/[-\d.]+(?:e[-+]?\d+)?/gi).map(Number);
  assert.ok(Math.abs(half[0]-100)<1e-8);assert.ok(Math.abs(half[1]-12)<1e-8);
  // The second outer arc ends at the bottom for a 50% slice.
  assert.ok(arc(0,50).includes('100 188'));
  const full=arc(0,100);
  assert.ok(full.includes('100 188'));assert.ok(!full.includes('NaN'));
});
test('tooltip payloads preserve text while escaping HTML and attribute injection',()=>{
  const value=tooltip('Produto "<script>"',[['Valor','1 & 2']],"Evidência ' privada");
  assert.ok(!value.includes('<script>'));assert.ok(value.includes('&lt;script&gt;'));
  const encoded=value.slice('data-readout="'.length,-1),decoded=encoded.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
  assert.equal(JSON.parse(decoded).title,'Produto "<script>"');
});
test('more positive rows never claims growth when the positive value actually fell',()=>{
  const code=source.slice(source.indexOf('function comparison()'),source.indexOf('function renderB2C()'));
  const context={defs:{},data:{views:{b2c:{series:{month:{'2025-01':{positiveCount:100,positiveCents:100000n},'2026-01':{positiveCount:200,positiveCents:50000n}}}}}},sum:rows=>rows[0],$:()=>({value:'all'}),comparisonPeriods:()=>({previous:['2025-01'],current:['2026-01']}),periodRangeLabel:a=>a,int:String,esc:String,insight:(title,body)=>({title,body})};
  const output=vm.runInNewContext(code+'\ncomparison()',context);
  assert.ok(!output.title.includes('crescimento'));assert.ok(output.body.includes('caiu'));
  context.data.views.b2c.series.month['2026-01'].positiveCents=200000n;
  assert.ok(vm.runInNewContext(code+'\ncomparison()',context).title.includes('crescimento'));
});
