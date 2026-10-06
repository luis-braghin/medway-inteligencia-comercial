import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Run the actual client helpers against synthetic boundary cases. No source
// credentials, browser, network, or business records enter this laboratory.
const source=readFileSync(new URL('../dashboard/dist/app.js',import.meta.url),'utf8');
const helpers=['decimal','money','pct','positiveTicket','monthlyCsv'].map(name=>{
  const line=source.split(/\r?\n/).find(row=>row.startsWith(`function ${name}(`));
  assert.ok(line,`Missing client helper ${name}`);
  return line;
}).join('\n');
const client=vm.runInNewContext(helpers+'\n({pct,positiveTicket,monthlyCsv})');

test('signed percentages retain sign and valid decimals, including small negatives',()=>{
  assert.equal(client.pct(-1,3),'-33,33%');
  assert.equal(client.pct(-10000,1000000000),'-0,00%');
  assert.equal(client.pct(0,3),'0,00%');
  assert.equal(client.pct(1,3),'33,33%');
  assert.equal(client.pct(1,0),'—');
  assert.equal(client.pct(1,-3),'-33,33%');
});

test('ticket rounds to cents and keeps absent observations distinct from zero',()=>{
  assert.equal(client.positiveTicket({positiveCents:'10001',positiveCount:2}),5001n);
  assert.equal(client.positiveTicket({positiveCents:'0',positiveCount:0}),null);
});

test('CSV exports the displayed positive ticket and preserves the explicitly named positive sum',()=>{
  const csv=client.monthlyCsv([
    ['2026-01',{signedCents:'9999',positiveCents:'10000',positiveCount:2}],
    ['2026-02',{signedCents:'-100',positiveCents:'0',positiveCount:0}],
  ]);
  assert.equal(csv.replace(/^\ufeff/,'').split('\r\n')[0], '"mes";"valor_observado_brl";"linhas_positivas";"ticket_positivo_brl";"valor_positivo_brl"');
  assert.ok(csv.includes('"2026-01";"99,99";"2";"50,00";"100,00"'));
  assert.ok(csv.includes('"2026-02";"-1,00";"0";"";"0,00"'));
});

test('an incomparable refreshed publication clears the previous growth definition',()=>{
  const code=source.slice(source.indexOf('function comparison()'),source.indexOf('function renderB2C()'));
  const defs={growth:['stale']};
  const context={defs,data:{views:{b2c:{series:{month:{}}}}},sum:()=>({positiveCents:0n,positiveCount:0}),insight:()=> 'incomparable'};
  assert.equal(vm.runInNewContext(code+'\ncomparison()',context),'incomparable');
  assert.equal(Object.hasOwn(defs,'growth'),false);
});
test('embedded B2B filters reject mismatched plan or region totals and empty filters',()=>{
  const begin=source.indexOf('// BEGIN CONTRACT FILTERS');
  const end=source.search(/\n(?:let|const) contractArtifact=/);
  assert.ok(begin>=0&&end>begin);
  const embedded=vm.runInNewContext(source.slice(begin,end)+'\n({buildContractCube,filterContractCube,contractCubeCompatible})');
  const cube=embedded.buildContractCube({versionId:'v1',sourceSha256:'s1',records:[
    {status:'ativo',plan:'Pro',region:'Sul',licenses:10,monthly_minor_units:1000},
    {status:'ativo',plan:'Basic',region:'Norte',licenses:20,monthly_minor_units:2000},
  ]});
  const publication={versionId:'v1',manifest:{sources:[{sourceId:'b2b-json',sha256:'s1'}]},views:{b2b:embedded.filterContractCube(cube)}};
  assert.equal(embedded.contractCubeCompatible(cube,publication),true);
  for(const dimension of ['plan','region']){
    const changed={...cube,cells:cube.cells.map((cell,index)=>index?cell:{...cell,[dimension]:'Different'})};
    assert.equal(embedded.contractCubeCompatible(changed,publication),false);
  }
  assert.equal(embedded.filterContractCube(cube,{status:''}).count,0);
  assert.equal(embedded.filterContractCube(cube,{status:0}).count,0);
});
