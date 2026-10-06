import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSegmentArtifact,segmentMatrix,segmentCompatible} from '../src/segment-analysis.mjs';
const row=(month,channel,profile,product,amount,ambassador=null)=>({month,channel,buyer_icp:profile,product,amount_cents:amount,ambassador});
const records=[row('2026-01','Embaixador','6º ano','A',100,'Private person'),row('2026-01','Orgânico','6º ano','B',500),row('2026-02','Embaixador','5º ano','B',200,'Private person'),row('2026-01','Orgânico','5º ano','B',-5),row('2026-01','Orgânico','5º ano','B',0)];
const artifact=buildSegmentArtifact({records,versionId:'pinned',sourceSha256:'hash'});
test('associations exclude nonpositive rows, preserve exact sums and use the selected months',()=>{
 const all=segmentMatrix(artifact,'profileProduct',['2026-01','2026-02']);
 assert.equal(all.total,3);assert.equal(all.cells.reduce((n,c)=>n+c.positiveCents,0n),800n);
 const jan=segmentMatrix(artifact,'profileProduct',['2026-01']);assert.equal(jan.total,2);assert.deepEqual(jan.rows,['6º ano']);
 assert.equal(segmentMatrix(artifact,'profileProduct',[]).cramersV,null);
});
test('conditional dimensions restrict the universe and replace every ambassador identity',()=>{
 assert.ok(!JSON.stringify(artifact).includes('Private person'));
 const a=segmentMatrix(artifact,'ambassadorProfile',['2026-01']);assert.equal(a.total,1);assert.deepEqual(a.rows,['Grupo anônimo 01']);
 assert.equal(segmentMatrix(artifact,'eventProfile',['2026-01']).total,0);
 assert.equal(segmentMatrix(artifact,'ambassadorProfile',['2026-02']).rows[0],a.rows[0]);
});
test('generic numbered source labels preserve identity when another numbered group appears',()=>{
 const input=[row('2026-01','Embaixador','6º ano','A',100,'Embaixador 10')];
 const first=buildSegmentArtifact({records:input,versionId:'p',sourceSha256:'h'});
 const next=buildSegmentArtifact({records:[...input,row('2026-01','Embaixador','5º ano','B',200,'Embaixador 2')],versionId:'q',sourceSha256:'i'});
 assert.equal(first.pairs.ambassadorProfile[0][1],'Embaixador 10');
 assert.ok(next.pairs.ambassadorProfile.some(c=>c[1]==='Embaixador 10'));
 assert.ok(next.pairs.ambassadorProfile.some(c=>c[1]==='Embaixador 2'));
});
test('shares have row denominators and lift has the same eligible universe',()=>{
 const m=segmentMatrix(artifact,'profileProduct',['2026-01','2026-02']),c=m.cells.find(c=>c.row==='6º ano'&&c.col==='A');
 assert.equal(c.share,0.5);assert.equal(c.baseline,1/3);assert.equal(c.lift,1.5);assert.ok(Math.abs(m.cramersV-0.5)<1e-12);
});
test('a new publication or different source cannot reuse the frozen analytical release',()=>{
 const dto={versionId:'pinned',manifest:{sources:[{sourceId:'b2c-csv',sha256:'hash'}]}};
 assert.equal(segmentCompatible(artifact,dto),true);
 assert.equal(segmentCompatible(artifact,{...dto,versionId:'next'}),false);
 assert.equal(segmentCompatible(artifact,{...dto,manifest:{sources:[{sourceId:'b2c-csv',sha256:'other'}]}}),false);
 assert.throws(()=>segmentMatrix(artifact,'unknown',[]),/SEGMENT_PAIR_INVALID/);
});
