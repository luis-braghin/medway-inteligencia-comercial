import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {buildSegmentArtifact,segmentMatrix} from '../src/segment-analysis.mjs';
const source=readFileSync(new URL('../dashboard/dist/app.js',import.meta.url),'utf8');
const start=source.indexOf('function segmentReading('),end=source.indexOf('function segmentEvidence(',start);
const read=vm.runInNewContext(source.slice(start,end)+'\nsegmentReading');
const records=[];
for(let i=0;i<100;i++)records.push({month:'2026-01',channel:i<20?'Embaixador':'Orgânico',buyer_icp:'6º ano',product:i<40?'Extensivo R+':'Extensivo R1',amount_cents:100,ambassador:'Embaixador 1'});
for(let i=0;i<100;i++)records.push({month:'2026-02',channel:i<60?'Embaixador':'Orgânico',buyer_icp:'Formado R+',product:i<70?'Extensivo R+':'Extensivo R1',amount_cents:100,ambassador:'Embaixador 2'});
const artifact=buildSegmentArtifact({records,versionId:'fixture',sourceSha256:'fixture'});
test('guided evidence uses profile denominator and the marginal of the same selected period',()=>{
 const m=segmentMatrix(artifact,'profileChannel',['2026-01','2026-02']),r=read(m,'channels');
 assert.equal(r.count,20);assert.equal(r.base,100);assert.equal(r.share,.2);assert.equal(r.baseline,.4);assert.equal(r.difference,-.2);assert.equal(r.available,true);
 const jan=read(segmentMatrix(artifact,'profileChannel',['2026-01']),'channels');assert.equal(jan.baseline,.2);assert.equal(jan.difference,0);
});
test('missing target and thin cells withhold the headline instead of recycling an earlier finding',()=>{
 assert.equal(read(segmentMatrix(artifact,'profileProduct',['2026-01']),'courses').available,false);
 const thin=buildSegmentArtifact({records:records.slice(0,4),versionId:'fixture',sourceSha256:'fixture'});
 const r=read(segmentMatrix(thin,'profileChannel',['2026-01']),'channels');assert.equal(r.available,false);assert.equal(r.count,4);
 const empty=read(segmentMatrix(artifact,'profileChannel',[]),'channels');assert.equal(empty.share,null);assert.equal(empty.baseline,null);assert.equal(empty.difference,null);
});
test('ambassador summary counts observed cells and missing identities without inventing performance',()=>{
 const a=buildSegmentArtifact({records:[...records,{...records[0],ambassador:null}],versionId:'fixture',sourceSha256:'fixture'});
 const r=read(segmentMatrix(a,'ambassadorProfile',['2026-01','2026-02']),'ambassadors');
 assert.equal(r.named,2);assert.equal(r.observedCells,3);assert.equal(r.smallCells,2);assert.equal(r.allSmall,false);
});
