import assert from 'node:assert/strict';
import test from 'node:test';
import {segmentArtifact,segmentMatrix,segmentCompatible} from '../dashboard/dist/segments.js';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { normalizeB2C, normalizeB2B } from '../src/normalize.mjs';
import { demoBundle, demoDTO, syntheticSources } from '../src/demo-data.mjs';
import { toDashboardDTO } from '../src/dashboard-dto.mjs';
import { createDemoServer } from '../src/demo-server.mjs';
import { buildPresentation, presentationMarkup } from '../dashboard/dist/presentation.js';
import * as publicPresentation from '../dashboard/dist/presentation.js';

test('dashboard module imports are supplied by the synthetic presentation edition',()=>{
  const app=readFileSync(new URL('../dashboard/dist/app.js',import.meta.url),'utf8');
  const names=app.match(/import\s*\{([^}]+)\}\s*from\s*['"]\.\/presentation\.js['"]/)[1].split(',').map(name=>name.trim());
  for(const name of names)assert.ok(Object.hasOwn(publicPresentation,name),`Missing presentation export: ${name}`);
});

test('synthetic inputs reproduce totals from records and preserve negative and zero lines',()=>{
  const sources=syntheticSources(),hash='a'.repeat(64);
  const normalized=normalizeB2C(sources.csv,hash),dto=demoDTO();
  assert.deepEqual(syntheticSources(),sources);
  assert.equal(dto.views.b2c.count,708);
  assert.equal(dto.views.b2c.negativeCount,1);
  assert.equal(dto.views.b2c.zeroCount,1);
  assert.equal(dto.views.b2c.signedCents,String(normalized.records.reduce((n,row)=>n+BigInt(row.amount_cents),0n)));
  assert.equal(dto.views.b2c.window.monthsB2C,19);
  const months=Object.values(dto.views.b2c.series.month);
  assert.equal(months.reduce((n,row)=>n+row.count,0),708);
  assert.equal(months.reduce((n,row)=>n+BigInt(row.signedCents),0n).toString(),dto.views.b2c.signedCents);
});
test('parsers reject incomplete snapshots, duplicate contract IDs and malformed dates',()=>{
  const {csv,json}=syntheticSources(),hash='b'.repeat(64),payload=JSON.parse(json);
  assert.throws(()=>normalizeB2B(JSON.stringify({...payload,total:9}),hash),/total/);
  assert.throws(()=>normalizeB2B(JSON.stringify({...payload,offset:1}),hash),/offset/);
  payload.contratos[1].id_contrato=payload.contratos[0].id_contrato;
  assert.throws(()=>normalizeB2B(JSON.stringify(payload),hash),/duplicate/);
  assert.throws(()=>normalizeB2C(csv.replace('2025-01-01','2025-02-30'),hash),/date/);
});
test('allowlisted DTO excludes nested private records, tokens and institutional identities',()=>{
  const bundle=demoBundle();
  bundle.raw={marker:'DO_NOT_EXPOSE'};
  bundle.manifest.access_token='DO_NOT_EXPOSE';
  bundle.views.b2b.institutions=['DO_NOT_EXPOSE'];
  bundle.views.b2c.series.month['2025-01'].raw='DO_NOT_EXPOSE';
  const text=JSON.stringify(toDashboardDTO(bundle));
  assert.ok(!text.includes('DO_NOT_EXPOSE'));
  assert.ok(!text.includes('Instituição fictícia'));
  assert.equal(bundle.views.total.official,null);
  assert.equal(toDashboardDTO(bundle).views.total.official??null,null);
  bundle.manifest.versionId='22222222-2222-4222-8222-222222222222';
  assert.throws(()=>toDashboardDTO(bundle),/version/);
});
test('public presentation has no private constants and supports last-slide bounds',()=>{
  const deck=buildPresentation(demoDTO());
  assert.equal(deck.slides.length,5);
  assert.ok(presentationMarkup(deck,99).includes('Slide 5 de 5'));
  assert.ok(presentationMarkup(deck,-1).includes('Slide 1 de 5'));
});
test('loopback demo serves allowlisted assets and rejects writes, foreign origins and arbitrary files',async t=>{
  const server=createDemoServer();server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin='http://127.0.0.1:'+server.address().port;
  for(const route of ['/','/app.js','/styles.css','/presentation.js','/segments.js','/api/architecture']) {
    const r=await fetch(origin+route);assert.equal(r.status,200,route);
    assert.equal(r.headers.get('x-content-type-options'),'nosniff');
  }
  assert.equal((await (await fetch(origin+'/api/dashboard')).json()).views.b2c.count,708);
  assert.equal((await fetch(origin+'/api/dashboard',{method:'POST'})).status,405);
  assert.equal((await fetch(origin+'/api/dashboard',{headers:{Origin:'https://external.example'}})).status,403);
  for(const route of ['/.env','/src/demo-data.mjs','/package.json','/api/dashboard?version=invalid']) {
    assert.ok([400,404].includes((await fetch(origin+route)).status),route);
  }
});

test('generated segment release belongs to the synthetic source and reconciles every eligible universe',()=>{
  const dto=demoDTO();assert.equal(segmentCompatible(segmentArtifact,dto),true);
  const months=Object.keys(dto.views.b2c.series.month);
  for(const id of Object.keys(segmentArtifact.pairs)){
    const expected=id.startsWith('ambassador')?dto.views.b2c.series.channel.Embaixador.positiveCount:id.startsWith('event')?dto.views.b2c.series.channel['Evento Presencial'].positiveCount:dto.views.b2c.positiveCount;
    assert.equal(segmentMatrix(segmentArtifact,id,months).total,expected,id);
  }
  assert.equal(segmentArtifact.currencyDeclaration.authority,'synthetic-demo-contract');
});
