import test from 'node:test';
import assert from 'node:assert/strict';
import {buildContractCube,filterContractCube,contractCubeCompatible} from '../src/b2b-filtering.mjs';
const records=[
  {status:'ativo',plan:'Enterprise',region:'Sul',licenses:10,monthly_minor_units:10001,contract_id:'SECRET_ID',institution:'PRIVATE'},
  {status:'ativo',plan:'Enterprise',region:'Norte',licenses:20,monthly_minor_units:20002},
  {status:'churn',plan:'Enterprise',region:'Sul',licenses:30,monthly_minor_units:30003},
  {status:'ativo',plan:'Starter',region:'Sul',licenses:40,monthly_minor_units:40004},
];
const cube=buildContractCube({records,versionId:'v1',sourceSha256:'s1'});
test('intersection filters match independent row sums and all group denominators',()=>{
  for(const status of ['all','ativo','churn'])for(const plan of ['all','Enterprise','Starter'])for(const region of ['all','Sul','Norte']){
    const filters={status,plan,region},rows=records.filter(r=>Object.entries(filters).every(([d,v])=>v==='all'||r[d]===v)),actual=filterContractCube(cube,filters);
    assert.equal(actual.count,rows.length);assert.equal(actual.licenses,rows.reduce((n,r)=>n+r.licenses,0));
    assert.equal(actual.sumMonthlyMinorUnits,rows.reduce((n,r)=>n+BigInt(r.monthly_minor_units),0n));
    for(const key of ['byPlan','byStatus','byRegion']){
      assert.equal(Object.values(actual[key]).reduce((n,c)=>n+c.count,0),actual.count);
      assert.equal(Object.values(actual[key]).reduce((n,c)=>n+c.sumMonthlyMinorUnits,0n),actual.sumMonthlyMinorUnits);
    }
  }
});
test('empty intersections return zero instead of full-base or prior values',()=>{
  assert.equal(filterContractCube(cube,{status:'churn',plan:'Starter'}).count,0);
  assert.equal(filterContractCube(cube,{region:'unknown'}).sumMonthlyMinorUnits,0n);
});
test('artifact never includes identity and stale data cannot be attached to a publication',()=>{
  assert.ok(!JSON.stringify(cube).includes('PRIVATE'));assert.ok(!JSON.stringify(cube).includes('SECRET_ID'));
  const dto={versionId:'v1',manifest:{sources:[{sourceId:'b2b-json',sha256:'s1'}]},views:{b2b:{count:4,byStatus:filterContractCube(cube).byStatus}}};
  assert.equal(contractCubeCompatible(cube,dto),true);
  assert.equal(contractCubeCompatible(cube,{...dto,versionId:'v2'}),false);
  assert.equal(contractCubeCompatible({...cube,sourceSha256:'s2'},dto),false);
  assert.equal(contractCubeCompatible(cube,{...dto,views:{b2b:{count:3}}}),false);
});
