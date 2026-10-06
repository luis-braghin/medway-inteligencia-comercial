import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { demoDTO } from './demo-data.mjs';

const STATIC = new Map([['/','index.html'],['/index.html','index.html'],['/app.js','app.js'],['/styles.css','styles.css'],['/presentation.js','presentation.js'],['/segments.js','segments.js'],['/segments.js','segments.js'],['/segments.js','segments.js']]);
const HEADERS = {'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' blob:; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"};
export function demoArchitecture() {
  return {nodes:[
    ['sources','01','FONTES','Dados sintéticos','CSV e envelope JSON gerados por fórmula, sem consultar os dados privados.','src/demo-data.mjs'],
    ['normalize','02','TRATAMENTO','Normalizar e validar','Datas, centavos, categorias e integridade do snapshot passam pelos mesmos parsers do case.','src/normalize.mjs'],
    ['views','03','CÁLCULO','Separar observado e hipótese','Valores negativos e zero são preservados. B2B sem moeda não integra um total financeiro oficial.','src/views.mjs'],
    ['publish','04','LEITURA','Publicar agregados','O DTO usa allowlists, recompõe objetos e retira identidades e registros brutos.','src/dashboard-dto.mjs'],
    ['dashboard','05','INTERFACE','Explorar o dashboard','Filtros de período, gráficos, definições, tabela e exportação refletem uma única versão.','dashboard/dist/app.js']
  ].map(([id,step,group,title,explanation,reference])=>({id,step,group,title,explanation,status:'demo',statusLabel:'Demonstração local',guarantees:['Dados inteiramente fictícios','Sem conexão com serviços externos'],technical:'Esta edição não instala nem agenda a ingestão privada. A documentação distingue o demo do portal hospedado.',references:[reference]}))};
}
export function createDemoServer() {
  const dto=demoDTO();
  return http.createServer(async(req,res)=>{
    const send=(code,value,type='application/json; charset=utf-8')=>{res.writeHead(code,{...HEADERS,'Content-Type':type});res.end(req.method==='HEAD'?undefined:value);};
    const json=(code,value)=>send(code,JSON.stringify(value));
    const port=res.socket.localPort;
    const hosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
    if(!hosts.has(req.headers.host))return json(403,{code:'HOST_NOT_ALLOWED'});
    if(req.headers['sec-fetch-site']==='cross-site'||req.headers.origin&&!new Set([...hosts].map(h=>'http://'+h)).has(req.headers.origin))return json(403,{code:'ORIGIN_NOT_ALLOWED'});
    if(!['GET','HEAD'].includes(req.method))return json(405,{code:'METHOD_NOT_ALLOWED'});
    let url;try{url=new URL(req.url,'http://127.0.0.1');}catch{return json(400,{code:'URL_INVALID'});}
    if(url.search)return json(400,{code:'QUERY_NOT_SUPPORTED'});
    if(url.pathname==='/api/dashboard')return json(200,dto);
    if(url.pathname==='/api/architecture')return json(200,demoArchitecture());
    const asset=STATIC.get(url.pathname);
    if(!asset)return json(404,{code:'NOT_FOUND'});
    try{send(200,await readFile(new URL('../dashboard/dist/'+asset,import.meta.url)),asset.endsWith('.css')?'text/css; charset=utf-8':asset.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8');}
    catch{json(503,{code:'ASSET_UNAVAILABLE'});}
  });
}
