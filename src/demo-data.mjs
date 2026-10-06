import { createHash } from 'node:crypto';
import { normalizeB2C, normalizeB2B } from './normalize.mjs';
import { buildViews, VIEW_FORMULA_VERSION } from './views.mjs';
import { toDashboardDTO } from './dashboard-dto.mjs';

// Generated from a formula; never derived from the private case dataset.
export const DEMO_VERSION = '11111111-1111-4111-8111-111111111111';
const AT = '2026-08-01T12:00:00Z';
const hash = value => createHash('sha256').update(value).digest('hex');
const csvCell = value => '"' + String(value).replaceAll('"', '""') + '"';

export function syntheticSources() {
  const header = ['data_venda','quarter','origem','embaixador','tipo_evento','regiao_evento','produto','icp_comprador','cupom','valor_pago'];
  const channels = ['Orgânico','Evento Presencial','Indicação Direta','Embaixador'];
  const products = ['Extensivo R1','Extensivo R+','Curso Avulso','Extensivo Programado 2','Extensivo Programado 1'];
  const rows = [header];
  for (let monthIndex=0; monthIndex<19; monthIndex++) {
    const year=2025+Math.floor(monthIndex/12), month=monthIndex%12+1;
    const count=18+monthIndex*2+(monthIndex===8?24:0);
    for(let i=0;i<count;i++) {
      const channel=channels[i%channels.length];
      const amount=i===0 && monthIndex===3?-250: i===1 && monthIndex===3?0:1200+monthIndex*80+(i%7)*135;
      rows.push([`${year}-${String(month).padStart(2,'0')}-${String(i%27+1).padStart(2,'0')}`,`Q${Math.ceil(month/3)}`,channel,channel==='Embaixador'?'Embaixador 01':'',channel==='Evento Presencial'?'Encontro Local':'',channel==='Evento Presencial'?'SP':'',products[i%5],['4º ano','5º ano','6º ano','Recém-formado','Formado R+'][(i+monthIndex)%5],'SEM_CUPOM',amount.toFixed(2).replace('.',',')]);
    }
  }
  const csv=rows.map(row=>row.map(csvCell).join(',')).join('\n');
  const json=JSON.stringify({total:8,offset:0,limit:8,contratos:Array.from({length:8},(_,i)=>({id_contrato:`DEMO-${i+1}`,instituicao:`Instituição fictícia ${i+1}`,tipo:'Faculdade',regiao:i%2?'SUL':'SP',plano:i%2?'Essencial':'Avançado',produto:'Plataforma de estudos',num_licencas:20+i*5,valor_mensal:900+i*120,data_inicio:`2025-${String(i+1).padStart(2,'0')}-15`,status:i<5?'ativo':i<7?'pausado':'churn'}))});
  return {csv,json};
}

export function demoBundle() {
  const {csv,json}=syntheticSources();
  const b2c=normalizeB2C(csv,hash(csv)),b2b=normalizeB2B(json,hash(json));
  const sources=[['b2c-csv',csv],['b2b-json',json]].map(([sourceId,text])=>({sourceId,sha256:hash(text),bytes:Buffer.byteLength(text),localReadAt:AT,sourceAsOf:null,mode:'frozen-local-snapshot',captureMeaning:'Fonte sintética gerada localmente'}));
  const views=buildViews({b2c,b2b,versionId:DEMO_VERSION,sources,calculatedAt:AT});
  return {version_id:DEMO_VERSION,manifest:{versionId:DEMO_VERSION,capturedAt:AT,publishedAt:AT,executionMode:'local-frozen-snapshots',viewFormulaVersion:VIEW_FORMULA_VERSION,transformationVersion:'medway-normalize-v1',sourceCredentialRightsVerified:false,sources,quality:{b2c:b2c.quality,b2b:b2b.quality}},views};
}

export const demoDTO = () => toDashboardDTO(demoBundle());
