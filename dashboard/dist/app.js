import { buildPresentation, presentationMarkup } from './presentation.js';
const $ = selector => document.querySelector(selector);
const view = $('#view');
let data = null, architecture = null, page = 'b2c', selectedNode = 'sources', loading = false;
let slideIndex = 0, presentationFocus = true;
const defs = {
  signed: ['Valor B2C observado', 'Soma de todas as linhas do CSV no período selecionado, em centavos BRL. Inclui valores positivos, negativos e zero; ocorrências iguais são preservadas porque a fonte não fornece ID de venda. O campo não comprova recebimento em caixa, reconhecimento contábil ou margem.'],
  sales: ['Linhas com valor positivo', 'Contagem das linhas cujo valor é maior que zero. Cada linha é uma ocorrência da fonte; não representa necessariamente um cliente ou uma transação única. Uma linha negativa e uma linha zero são tratadas separadamente.'],
  ticket: ['Ticket das linhas positivas', 'Soma dos valores positivos dividida pela quantidade de linhas positivas do mesmo recorte. A fração original é exata; o valor exibido é arredondado para centavos. Não divide o saldo líquido por todas as linhas.'],
  months: ['Cobertura do período', 'Meses entre a primeira e a última data de venda na base, incluindo meses intermediários sem registros. Ano de 2026 possui somente janeiro a julho. Comparações de crescimento devem usar janelas equivalentes.'],
  contracts: ['Contratos por status atual', 'Contagem dos IDs de contrato no snapshot recebido. O status é o observado nessa captura. Não fornece trajetória de ativação, pausa ou churn e não permite calcular uma taxa histórica de churn.'],
  licenses: ['Licenças declaradas', 'Soma de num_licencas dos contratos com status atual ativo. Não representa uso efetivo, usuários únicos ou número de profissionais impactados.'],
  monthly: ['Campo mensal dos contratos ativos', 'Soma de valor_mensal nos contratos com status atual ativo. A API não declara moeda nem data factual de referência. O valor é exibido em unidades da fonte, sem símbolo monetário. Ainda não é possível homologá-lo como MRR ou receita realizada.'],
  official: ['Total financeiro oficial', 'Indisponível. O B2C é um fluxo BRL observado; o B2B é um snapshot recorrente sem moeda e sem histórico de vigência. Para consolidar financeiramente, é preciso confirmar a moeda, a elegibilidade dos contratos, sua vigência e uma definição temporal compatível.'],
  scenario: ['Composição mensal modelada', 'Hipóteses explícitas: B2B em BRL; contratos com status atual ativo contribuem desde o mês de início; mês cheio, mesmo quando o início é no meio do mês; todos os IDs elegíveis coexistem. Soma com o B2C do mesmo mês. A premissa usa status atual ao longo da janela e não reconstrói status histórico, pagamentos ou receita realizada.']
};
const pageNames={b2c:'Vendas B2C',b2b:'Contratos B2B',total:'Visão conjunta',architecture:'Como funciona',quality:'Fontes e qualidade',presentation:'Apresentação'};
const headings = {
  b2c: ['01 / VENDAS B2C', 'Da venda à decisão.', 'Valores, volume e mix comercial, com o mesmo período em toda a visão.'],
  b2b: ['02 / CONTRATOS B2B', 'Uma leitura da carteira.', 'Contratos e licenças conforme o status observado no envelope sintético da API.'],
  total: ['03 / VISÃO CONJUNTA', 'Consolidar com critério.', 'Componentes observados e uma composição mensal com premissas explícitas.'],
  architecture: ['04 / ARQUITETURA', 'Cada etapa tem um propósito.', 'Clique no fluxo para entender o que acontece, como verificamos e o que falta operar.'],
  quality: ['05 / FONTES & QUALIDADE', 'Confiança começa na origem.', 'Uma publicação rastreável, dados preservados e limites visíveis.'],
  presentation: ['06 / APRESENTAÇÃO', 'O case, em sequência.', 'Insights, decisões e solução. Use as setas para navegar.']
};
function esc(v) { return String(v ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])); }
function int(v) { return new Intl.NumberFormat('pt-BR').format(v ?? 0); }
function decimal(cents) { const n=BigInt(cents ?? 0), neg=n<0n, a=neg?-n:n; return (neg?'-':'') + (a/100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,'.') + ',' + (a%100n).toString().padStart(2,'0'); }
function money(cents) { return 'R$ ' + decimal(cents); }
function short(cents) { const n=BigInt(cents), a=n<0n?-n:n, sign=n<0n?'-':''; const [scale,unit]=a>=100000000n?[100000000n,'mi']:a>=100000n?[100000n,'mil']:[100n,'']; const tenths=(a*10n+scale/2n)/scale; return sign+(tenths/10n)+','+(tenths%10n)+(unit?' '+unit:''); }
function pct(num,den) { const n=BigInt(num),d=BigInt(den);if(d===0n)return '—';const negative=(n<0n)!==(d<0n),p=((n<0n?-n:n)*10000n)/(d<0n?-d:d);return (negative&&n!==0n?'-':'')+(p/100n).toString()+','+(p%100n).toString().padStart(2,'0')+'%'; }
function positiveTicket(row){return row.positiveCount>0?(BigInt(row.positiveCents)+BigInt(row.positiveCount)/2n)/BigInt(row.positiveCount):null;}
function monthlyCsv(entries){const rows=[['mes','valor_observado_brl','linhas_positivas','ticket_positivo_brl','valor_positivo_brl'],...entries.map(([m,x])=>{const ticket=positiveTicket(x);return[m,decimal(x.signedCents),String(x.positiveCount),ticket===null?'':decimal(ticket),decimal(x.positiveCents)];})];return '\ufeff'+rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(';')).join('\r\n');}
function monthLabel(v,long=false) { const [y,m]=v.split('-'); return ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][Number(m)-1]+'/'+(long?y:y.slice(2)); }
function periodSelection(value,keys) { const available=keys.filter(m=>/^\d{4}-(0[1-9]|1[0-2])$/.test(m)).sort();if(!available.length)return null;let selected;if(value==='all')selected=available;else if(/^\d{4}(-h1)?$/.test(value))selected=available.filter(m=>m.startsWith(value.slice(0,4)+'-')&&(!value.endsWith('-h1')||m.slice(5)<='07'));else{const parts=/^range:(\d{4}-(?:0[1-9]|1[0-2])):(\d{4}-(?:0[1-9]|1[0-2]))$/.exec(value);if(!parts||parts[1]>parts[2]||parts[1]<available[0]||parts[2]>available.at(-1))return null;selected=available.filter(m=>m>=parts[1]&&m<=parts[2]);}return selected.length?{start:selected[0],end:selected.at(-1),months:selected}:null; }
function comparisonPeriods(keys,value) { const sorted=[...keys].sort(),latestYear=sorted.at(-1)?.slice(0,4),selected=value==='all'?periodSelection(latestYear??'',sorted):periodSelection(value,sorted);if(!selected||selected.months.length>12)return null;const previous=selected.months.map(m=>String(Number(m.slice(0,4))-1).padStart(4,'0')+m.slice(4));if(previous.some(m=>!keys.includes(m)))return null;return {current:selected.months,previous}; }
function periodRangeLabel(start,end) { const first=monthLabel(start,true).replace('/',' '),last=monthLabel(end,true).replace('/',' ');return start===end?first:first+' — '+last; }
function periodPresets(keys) { const sorted=[...keys].sort(),years=[...new Set(sorted.map(m=>m.slice(0,4)))].reverse(),all=periodSelection('all',sorted);if(!all)return [];const presets=[{value:'all',label:'Toda a base',...all}];const latest=periodSelection(years[0],sorted);if(latest.start!==all.start||latest.end!==all.end)presets.push({value:years[0],label:years[0]+' · '+(latest.months.length===12?'ano completo':'período disponível'),...latest});const previous=years[1]&&periodSelection(years[1],sorted);if(previous){const pairs=comparisonPeriods(sorted,years[0]);if(pairs&&pairs.previous.length<previous.months.length)presets.push({value:'range:'+pairs.previous[0]+':'+pairs.previous.at(-1),label:years[1]+' · '+monthLabel(pairs.previous[0]).slice(0,3)+'–'+monthLabel(pairs.previous.at(-1)).slice(0,3),start:pairs.previous[0],end:pairs.previous.at(-1),months:pairs.previous});presets.push({value:years[1],label:years[1]+' · '+(previous.months.length===12?'ano completo':'período disponível'),...previous});}return presets; }
let draftPeriod='all';
function updatePeriodUI() {
  const keys=Object.keys(data.views.b2c.series.month),selected=periodSelection($('#period').value,keys);
  if(!selected&&keys.length){$('#period').value='all';status('O período anterior não existe nesta publicação. Exibindo toda a base.',true);}
  const actual=selected??periodSelection('all',keys),visible=['b2c','total'].includes(page);
  $('#filter-context').hidden=!visible;$('#open-period').disabled=!actual;
  $('#period-summary').textContent=actual?periodRangeLabel(actual.start,actual.end):'Sem período disponível';
  $('#period-kind').textContent=$('#period').value==='all'?'Toda a base':'Filtrado';
  $('#period-control').classList.toggle('is-filtered',$('#period').value!=='all');
  $('#clear-period').hidden=$('#period').value==='all';
  $('#filter-context-copy').textContent=actual?actual.months.length+' '+(actual.months.length===1?'mês selecionado':'meses selecionados')+' · '+(page==='total'?'Vendas e cenário mensal filtrados; carteira B2B mantém o snapshot.':'Mesmo período nos indicadores, gráficos e exportação.'):'A publicação não contém meses disponíveis.';
}
function updatePeriodDraft() {
  const keys=Object.keys(data.views.b2c.series.month),selected=periodSelection(draftPeriod,keys),valid=!!selected;
  $('#apply-period').disabled=!valid;$('#period-error').hidden=valid;
  for(const id of ['period-start','period-end']){$('#'+id).setAttribute('aria-invalid',String(!valid));$('#'+id).setAttribute('aria-describedby','period-error period-draft-summary');}
  $('#period-error').textContent='O mês inicial deve ser anterior ou igual ao mês final.';
  $('#period-draft-summary').textContent=valid?selected.months.length+' '+(selected.months.length===1?'mês selecionado':'meses selecionados')+' · '+periodRangeLabel(selected.start,selected.end):'Ajuste o intervalo para continuar.';
  document.querySelectorAll('[data-period-preset]').forEach(button=>{const preset=periodSelection(button.dataset.periodPreset,keys),active=valid&&preset?.start===selected.start&&preset?.end===selected.end;button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));});
}
function openPeriod() {
  if(!data)return;const keys=Object.keys(data.views.b2c.series.month).sort(),selected=periodSelection($('#period').value,keys);if(!selected)return;
  draftPeriod=$('#period').value;
  $('#period-presets').innerHTML=periodPresets(keys).map(p=>`<button type="button" class="period-preset" data-period-preset="${esc(p.value)}" aria-pressed="false"><span><strong>${esc(p.label)}</strong><small>${esc(periodRangeLabel(p.start,p.end))}</small></span><span class="period-preset-check" aria-hidden="true">✓</span></button>`).join('');
  const options=keys.map(m=>`<option value="${esc(m)}">${esc(monthLabel(m,true).replace('/',' '))}</option>`).join('');
  $('#period-start').innerHTML=options;$('#period-end').innerHTML=options;$('#period-start').value=selected.start;$('#period-end').value=selected.end;
  const rect=$('#open-period').getBoundingClientRect();$('#period-dialog').style.setProperty('--period-left',Math.max(12,Math.min(rect.right-420,innerWidth-432))+'px');$('#period-dialog').style.setProperty('--period-top',Math.max(12,Math.min(rect.bottom+10,innerHeight-590))+'px');
  updatePeriodDraft();$('#open-period').setAttribute('aria-expanded','true');$('#period-dialog').showModal();positionPeriodDialog();
}
function positionPeriodDialog() { const dialog=$('#period-dialog');if(!dialog.open||innerWidth<=600)return;const rect=$('#open-period').getBoundingClientRect(),size=dialog.getBoundingClientRect();dialog.style.setProperty('--period-left',Math.max(12,Math.min(rect.right-size.width,innerWidth-size.width-12))+'px');dialog.style.setProperty('--period-top',Math.max(12,Math.min(rect.bottom+10,innerHeight-size.height-12))+'px'); }
window.addEventListener('resize',positionPeriodDialog);
function closePeriod() { $('#period-dialog').close(); }
$('#open-period').addEventListener('click',openPeriod);
$('#period-presets').addEventListener('click',event=>{const button=event.target.closest('[data-period-preset]');if(!button)return;draftPeriod=button.dataset.periodPreset;const selected=periodSelection(draftPeriod,Object.keys(data.views.b2c.series.month));if(!selected)return;$('#period-start').value=selected.start;$('#period-end').value=selected.end;updatePeriodDraft();});
for(const id of ['period-start','period-end'])$('#'+id).addEventListener('change',()=>{draftPeriod='range:'+$('#period-start').value+':'+$('#period-end').value;updatePeriodDraft();});
for(const id of ['close-period','cancel-period'])$('#'+id).addEventListener('click',closePeriod);
$('#period-dialog').addEventListener('close',()=>{$('#open-period').setAttribute('aria-expanded','false');$('#open-period').focus({preventScroll:true});});
$('#period-dialog').addEventListener('click',event=>{if(event.target!==$('#period-dialog'))return;const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closePeriod();});
$('#apply-period').addEventListener('click',()=>{const keys=Object.keys(data.views.b2c.series.month),selected=periodSelection(draftPeriod,keys),all=periodSelection('all',keys);if(!selected)return;$('#period').value=selected.start===all.start&&selected.end===all.end?'all':draftPeriod;closePeriod();render();});
$('#clear-period').addEventListener('click',()=>{$('#period').value='all';render();$('#open-period').focus({preventScroll:true});});
function dateTime(v) { return v ? new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(v)) : 'Não informada'; }
function matches(month) { const selected=periodSelection($('#period').value,Object.keys(data.views.b2c.series.month));return !!selected&&month>=selected.start&&month<=selected.end; }
function months() { return Object.entries(data.views.b2c.series.month).filter(([m])=>matches(m)); }
function sum(rows) { const r={count:0,positiveCount:0,negativeCount:0,zeroCount:0,signedCents:0n,positiveCents:0n,negativeCents:0n}; for(const x of rows){for(const k of ['count','positiveCount','negativeCount','zeroCount'])r[k]+=x[k];for(const k of ['signedCents','positiveCents','negativeCents'])r[k]+=BigInt(x[k]);}return r; }
function groups(dimension) { const series=data.views.b2c.series[dimension==='channel'?'monthChannel':'monthProduct']; if(!series) return $('#period').value==='all'?data.views.b2c.series[dimension]:{}; const result=new Map(); for(const [m,categories]of Object.entries(series)){if(!matches(m))continue;for(const [name,row]of Object.entries(categories)){if(!result.has(name))result.set(name,[]);result.get(name).push(row);}}return Object.fromEntries([...result].map(([name,rows])=>[name,sum(rows)])); }
function uiIcon(name) {
  const paths={money:'<circle cx="12" cy="12" r="9"/><path d="M15 8.5c-1-2-6-1.5-6 1s6 1.5 6 4-5 3-6 1M12 5v14"/>',trend:'<path d="m3 17 6-6 4 4 8-10M15 5h6v6"/>',ticket:'<path d="m13 3 8 8-10 10-8-8V5l2-2h8Z"/><circle cx="8" cy="8" r="1"/>',calendar:'<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4m8-4v4M4 11h16"/>',bars:'<path d="M5 20V12m7 8V7m7 13V3"/>',share:'<circle cx="5" cy="12" r="3"/><circle cx="19" cy="5" r="3"/><circle cx="19" cy="19" r="3"/><path d="m8 10 8-4m-8 8 8 4"/>',pie:'<path d="M12 3v9l8 4A9 9 0 1 1 12 3Z"/><path d="M15 3.5V9h5.5A9 9 0 0 0 15 3.5Z"/>',file:'<path d="M14 3H5v18h14V8l-5-5ZM14 3v5h5M8 12h8m-8 4h6"/>',contracts:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h1m6 0h1M8 12h1m6 0h1M10 21v-4h4v4"/>',people:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-16a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 4v2"/>',shield:'<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Z"/><path d="m8 12 3 3 5-6"/>',search:'<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>'};
  return `<svg class="ui-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name]??paths.bars}</svg>`;
}
function metric(label,value,foot,definition,accent=false){const symbol={signed:'money',sales:'bars',ticket:'ticket',months:'calendar',contracts:'contracts',licenses:'people',monthly:'money',official:'shield',scenario:'trend'}[definition];return `<article class="metric${accent?' accent':''}"><div class="metric-heading"><span class="metric-symbol symbol-${esc(definition)}">${uiIcon(symbol)}</span><span class="metric-label">${esc(label)}</span></div><button class="metric-info" data-definition="${esc(definition)}" aria-label="Entender ${esc(label)}">ⓘ</button><strong class="metric-value">${esc(value)}</strong><span class="metric-foot">${esc(foot)}</span></article>`;}
function panel(title,subtitle,body,badge='OBSERVADO',klass='observed') { const symbol=title.includes('canais')?'share':title.includes('Mix')?'pie':title.includes('mensal')||title.includes('Composição mensal')?'bars':title.includes('mês')?'file':title.includes('status')||title.includes('plano')?'contracts':'file';return `<article class="panel"><div class="panel-header"><div class="panel-heading"><span class="panel-symbol">${uiIcon(symbol)}</span><div><h2>${esc(title)}</h2><p class="panel-subtitle">${esc(subtitle)}</p></div></div><span class="badge ${klass}">${esc(badge)}</span></div>${body}</article>`; }
function insight(title,body,definition=null) { return `<article class="insight"><div class="insight-icon">${uiIcon('trend')}</div><div class="insight-copy"><h3>${esc(title)}</h3><p>${body}</p></div>${definition?`<button class="button insight-action" data-definition="${esc(definition)}">Ver análise ${uiIcon('arrow')}</button>`:''}</article>`; }
function sortedAmounts(values) { return Object.entries(values).sort((a,b)=>{const x=BigInt(a[1].signedCents??a[1].sumMonthlyMinorUnits),y=BigInt(b[1].signedCents??b[1].sumMonthlyMinorUnits);return x===y?a[0].localeCompare(b[0],'pt-BR'):x>y?-1:1;}); }
function rank(values,type='money') {
  const entries=sortedAmounts(values);
  if(!entries.length)return '<p class="note-box">Não há detalhamento por categoria disponível neste recorte.</p>';
  const total=entries.reduce((n,[,r])=>n+BigInt(r.signedCents??r.sumMonthlyMinorUnits),0n);
  const max=entries.reduce((n,[,r])=>{const v=BigInt(r.signedCents??r.sumMonthlyMinorUnits);return v>n?v:n;},1n);
  const showShares=type==='money'&&total>0n&&entries.every(([,r])=>BigInt(r.signedCents??r.sumMonthlyMinorUnits)>=0n);
  const denominator=showShares?total:max;
  return `<div class="rank">${entries.map(([name,row])=>{const amount=BigInt(row.signedCents??row.sumMonthlyMinorUnits),width=Math.max(0,Math.min(100,Number(amount*10000n/denominator)/100));return `<div class="rank-row"><div class="rank-top"><span class="rank-name">${esc(name==='__missing__'?'Não informado':name)}</span><span class="rank-value">${esc(type==='money'?money(amount):decimal(amount))}</span>${showShares?`<span class="rank-percent">${esc(pct(amount,total))}</span>`:''}</div><div class="rank-track"><div class="rank-fill" style="width:${width}%"></div></div></div>`;}).join('')}</div>`;
}
function productMix(values) {
  const entries=sortedAmounts(values),total=entries.reduce((n,[,r])=>n+BigInt(r.signedCents),0n);
  if(total<=0n||entries.some(([,r])=>BigInt(r.signedCents)<0n))return rank(values);
  const colors=['#072963','#086cf0','#65adff','#30c7b7','#cfdfef'];
  let offset=0;
  const slices=entries.map(([name,row],i)=>{const share=Number(BigInt(row.signedCents)*1000000n/total)/10000,start=offset;offset+=share;return `<circle cx="100" cy="100" r="72" fill="none" stroke="${colors[i%colors.length]}" stroke-width="32" pathLength="100" stroke-dasharray="${share} ${100-share}" stroke-dashoffset="${-start}" transform="rotate(-90 100 100)"><title>${esc(name)} · ${esc(pct(row.signedCents,total))}</title></circle>`;}).join('');
  return `<div class="product-mix"><div class="donut-wrap"><svg viewBox="0 0 200 200" role="img" aria-label="Participação dos produtos no saldo observado; valores na legenda">${slices}</svg><div class="donut-center"><strong>R$ ${esc(short(total))}</strong><span>Total observado</span></div></div><div class="mix-legend">${entries.map(([name,row],i)=>`<div class="rank-row mix-row"><span class="mix-dot" style="background:${colors[i%colors.length]}"></span><span class="rank-name">${esc(name==='__missing__'?'Não informado':name)}</span><strong>${esc(pct(row.signedCents,total))}</strong></div>`).join('')}</div></div>`;
}
function chart(rows,scenario=false) {
  const narrow=innerWidth<=1100,ratio=innerWidth<=1400?1.35/2.35:1.55/2.55;
  const width=Math.round(Math.max(260,Math.min(680,view.clientWidth*(narrow?1:ratio)-(narrow?36:54)))),height=220,left=52,right=20,top=12,bottom=35,plotH=height-top-bottom,plotW=width-left-right;
  const labelCount=Math.max(2,Math.min(rows.length,Math.floor(plotW/65)));
  const labelIndices=new Set(Array.from({length:labelCount},(_,i)=>Math.round(i*(rows.length-1)/(labelCount-1))));
  let min=0n,max=0n;
  for(const [,amount,extra] of rows){const a=BigInt(amount),b=scenario?BigInt(extra):0n;min=a<min?a:min;const positive=(a>0n?a:0n)+(b>0n?b:0n);max=positive>max?positive:max;}
  if(max===min)max=min+1n;
  const span=max-min, y=n=>top+Number((max-BigInt(n))*1000000n/span)/1000000*plotH,zero=y(0n),slot=plotW/Math.max(rows.length,1),bw=Math.min(28,slot*.59);
  let html=`<div class="chart-frame"><svg class="chart" role="group" aria-roledescription="Gráfico de barras" aria-label="${scenario?'Composição mensal modelada em BRL':'Valor B2C mensal observado em BRL'}; valores completos na tabela" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="medway-bar-blue" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#052b70"/><stop offset="1" stop-color="#086bec"/></linearGradient></defs>`;
  for(let i=0;i<4;i++){const value=min+span*BigInt(i)/3n;html+=`<line class="grid-line" x1="${left}" x2="${width-right}" y1="${y(value)}" y2="${y(value)}"/><text x="${left-8}" y="${y(value)+3}" text-anchor="end">${esc(short(value))}</text>`;}
  html+=`<line class="axis" x1="${left}" x2="${width-right}" y1="${zero}" y2="${zero}"/>`;
  for(let i=0;i<rows.length;i++){const [month,amount,extra]=rows[i],a=BigInt(amount),x=left+i*slot+(slot-bw)/2,ay=y(a),h=Math.abs(zero-ay);html+=`<rect class="bar" tabindex="0" data-chart-label="${esc(monthLabel(month,true))} · B2C" data-chart-value="${esc(money(amount))}" role="img" aria-label="${esc(monthLabel(month,true))}, B2C: ${esc(money(amount))}" x="${x}" y="${Math.min(ay,zero)}" width="${bw}" height="${h}" rx="2"><title>${esc(monthLabel(month,true))}: B2C ${esc(money(amount))}</title></rect>`;
    if(scenario){const start=a>0n?a:0n,end=start+BigInt(extra),ey=y(end),sy=y(start);html+=`<rect class="b2b-bar" tabindex="0" data-chart-label="${esc(monthLabel(month,true))} · B2B modelado" data-chart-value="${esc(money(extra))}" role="img" aria-label="${esc(monthLabel(month,true))}, B2B modelado: ${esc(money(extra))}" x="${x}" y="${Math.min(ey,sy)}" width="${bw}" height="${Math.abs(sy-ey)}" rx="2"><title>${esc(monthLabel(month,true))}: B2B modelado ${esc(money(extra))}</title></rect>`;}
    if(labelIndices.has(i))html+=`<text x="${x+bw/2}" y="${height-12}" text-anchor="middle">${esc(monthLabel(month))}</text>`;
  }
  return html+'</svg><div class="chart-tooltip" hidden></div></div>';
}
function table(headers,rows) { return `<p class="table-scroll-hint" hidden>Deslize a tabela para ver todas as colunas ↔</p><div class="table-wrap" tabindex="0" role="region" aria-label="Tabela de dados, com rolagem horizontal quando necessária"><table class="detail-table"><thead><tr>${headers.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(cells=>`<tr>${cells.map(x=>`<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; }
function updateTableScrollHints(){view.querySelectorAll('.table-wrap').forEach(w=>{if(w.previousElementSibling?.classList.contains('table-scroll-hint'))w.previousElementSibling.hidden=w.scrollWidth<=w.clientWidth+1;});}
view.addEventListener('toggle',updateTableScrollHints,true);
function comparison() {
  delete defs.growth;
  const series=data.views.b2c.series.month,keys=Object.keys(series).sort();
  const unavailable=()=>insight('Cada recorte pede uma comparação equivalente.','Não há uma janela equivalente do ano anterior disponível para este período. Explore os valores observados sem inferir uma variação de crescimento.');
  if(!keys.length)return unavailable();
  const pairs=comparisonPeriods(keys,$('#period').value);
  if(!pairs)return unavailable();
  const a=sum(pairs.previous.map(m=>series[m])),b=sum(pairs.current.map(m=>series[m]));
  if(a.positiveCents<=0n||!a.positiveCount||!b.positiveCount)return unavailable();
  const volume=(b.positiveCount-a.positiveCount)/a.positiveCount*100;
  const ticket=(Number(b.positiveCents)*a.positiveCount/(Number(a.positiveCents)*b.positiveCount)-1)*100;
  const format=n=>n.toFixed(2).replace('.',','),currentLabel=periodRangeLabel(pairs.current[0],pairs.current.at(-1)),previousLabel=periodRangeLabel(pairs.previous[0],pairs.previous.at(-1));
  const scope=$('#period').value==='all'?'Ano mais recente disponível · meses equivalentes.':'Mesmo recorte de meses · ano anterior.';
  defs.growth=['Volume e ticket, em janelas equivalentes.',`${currentLabel} versus ${previousLabel}: as linhas positivas variaram ${format(volume)}% e o ticket positivo ${format(ticket)}%. ${scope} O ticket divide o valor positivo pelas linhas positivas de cada janela. A comparação não prova causalidade, conversão ou ROI.`];
  return insight('Volume e ticket, em janelas equivalentes.',`${esc(currentLabel)} vs. ${esc(previousLabel)}: linhas positivas <strong>${volume>=0?'+':''}${esc(format(volume))}%</strong> e ticket positivo <strong>${ticket>=0?'+':''}${esc(format(ticket))}%</strong>. <span class="insight-scope">${esc(scope)}</span>`,'growth');
}
function renderB2C(){
  const entries=months(),r=sum(entries.map(([,x])=>x)),ticket=r.positiveCount?(r.positiveCents+BigInt(r.positiveCount)/2n)/BigInt(r.positiveCount):null;
  const monthlyRows=rows=>rows.map(([m,x])=>[monthLabel(m,true),money(x.signedCents),int(x.positiveCount),positiveTicket(x)===null?'—':money(positiveTicket(x))]);
  view.innerHTML=`<div class="metrics">${metric('Valor B2C observado',money(r.signedCents),'Soma com positivos, negativos e zero','signed',true)}${metric('Linhas com valor positivo',int(r.positiveCount),int(r.count)+' linhas no recorte','sales')}${metric('Ticket positivo',ticket===null?'—':money(ticket),'Média das linhas com valor maior que zero','ticket')}${metric('Meses no recorte',int(entries.length),entries.length?monthLabel(entries[0][0],true)+' — '+monthLabel(entries.at(-1)[0],true):'Sem registros','months')}</div><div class="grid-main">${panel('Evolução mensal','Valor observado · BRL · período selecionado',chart(entries.map(([m,x])=>[m,x.signedCents]))+'<div class="legend"><span>Valor B2C observado</span><span class="chart-cadence">Mensal</span></div>')}${panel('Participação dos canais','Ordenação por valor observado no mesmo recorte',rank(groups('channel')))}</div>${comparison()}<div class="two-columns b2c-bottom">${panel('Mix de produtos','Participação no valor observado · mesmo período',productMix(groups('product')))}${panel('Leitura por mês','Meses recentes · ticket das linhas positivas','<div class="monthly-preview">'+table(['Mês','Valor observado','Linhas +','Ticket +'],monthlyRows(entries.slice(-5).reverse()))+'</div><div class="monthly-actions"><details><summary>Ver todos os '+entries.length+' meses</summary>'+table(['Mês','Valor observado','Linhas +','Ticket +'],monthlyRows(entries))+'</details><button class="button" id="export-months">Exportar CSV ↓</button></div>')}</div><p class="note">${int(r.negativeCount)} linha(s) negativa(s) e ${int(r.zeroCount)} linha(s) de valor zero no recorte. Ocorrências iguais preservadas; a fonte não informa ID de venda. Valores não comprovam caixa, margem ou reconhecimento contábil.</p>`;
}
function renderB2B(){const b=data.views.b2b,active=b.byStatus.ativo??{count:0,licenses:0,sumMonthlyMinorUnits:'0'},all=Object.values(b.byStatus).reduce((n,x)=>n+x.licenses,0);view.innerHTML=`<div class="metrics">${metric('Contratos na captura',int(b.count),'Snapshot · status atual','contracts',true)}${metric('Contratos ativos',int(active.count),'Status observado, sem trajetória histórica','contracts')}${metric('Licenças em contratos ativos',int(active.licenses),int(all)+' licenças em todos os status','licenses')}${metric('Campo mensal · ativos',decimal(active.sumMonthlyMinorUnits),'Unidades da fonte · moeda não informada','monthly')}</div><div class="two-columns">${panel('Composição por status','Cada ID é mantido conforme o snapshot',table(['Status atual','Contratos','Licenças','Campo mensal'],Object.entries(b.byStatus).map(([status,x])=>[status,int(x.count),int(x.licenses),decimal(x.sumMonthlyMinorUnits)]))+'<p class="note">O rótulo churn é um status atual. Uma taxa histórica de churn exige eventos e uma base elegível por período.</p>')}${panel('Por plano','Todos os status · soma do campo mensal em unidades da fonte',rank(b.byPlan??{},'units'))}</div>${insight('Homologue a carteira antes de chamar o indicador de MRR.','Confirme <strong>moeda, data de referência, vigência e possíveis substituições entre contratos</strong>. IDs parecidos ou instituições com nomes semelhantes não comprovam renovação. Com os contratos elegíveis definidos, estabeleça uma regra única de receita recorrente.')}<div class="two-columns">${panel('Distribuição regional','Região contratual informada na API · todos os status',table(['Região','Contratos','Licenças'],Object.entries(b.byRegion??{}).map(([name,x])=>[name,int(x.count),int(x.licenses)])))}${panel('O que esta captura permite afirmar','Observação e interpretação permanecem separadas','<div class="note-box">Podemos contar contratos, licenças e somar o campo mensal por status, plano e região. Não podemos reconstruir status histórico, pagamentos, utilização de licenças ou uma relação de substituição entre IDs.</div><p class="note">Data factual de referência do servidor: não fornecida. O horário da importação local está disponível em Fontes e qualidade.</p>')}</div>`;}
function renderTotal(){const entries=months(),b2c=sum(entries.map(([,x])=>x)),c=data.views.total.monthlyComposition;if(!c){view.innerHTML='<div class="metrics">'+metric('Total financeiro oficial','Indisponível','Definições das fontes ainda incompatíveis','official',true)+metric('B2C no período',money(b2c.signedCents),'Componente BRL observado','signed')+metric('B2B modelado','Indisponível','Esta versão não contém um cenário mensal','scenario')+metric('Composição modelada','Indisponível','Ausência não é valor zero','scenario')+'</div>'+panel('Cenário mensal indisponível','Esta publicação não contém uma composição modelada','<div class="note-box amber">Os componentes observados permanecem nas visões B2C e B2B. Nenhuma hipótese ou soma conjunta foi inventada para preencher esta ausência.</div>','INDISPONÍVEL','scenario');return;}const rows=c.records.filter(r=>matches(r.month)),b2b=rows.reduce((n,r)=>n+BigInt(r.b2bSumMonthlyMinorUnits),0n),combined=rows.reduce((n,r)=>n+BigInt(r.combinedAssumedBrlCents),0n);view.innerHTML=`<div class="metrics">${metric('Total financeiro oficial','Indisponível','Definições das fontes ainda incompatíveis','official',true)}${metric('B2C no período',money(b2c.signedCents),'Componente BRL observado','signed')}${metric('B2B modelado no período',money(b2b),'Soma mensal sob hipótese BRL','scenario')}${metric('Composição modelada',money(combined),'Cenário · não é receita realizada','scenario')}</div><div class="note-box amber">Cenário explícito: B2B em BRL, status ativo da captura aplicado à janela, mês cheio desde o início e coexistência de todos os IDs elegíveis. As quatro premissas mudam a interpretação do total.</div><div class="grid-main" style="margin-top:23px">${panel('Composição mensal','B2C observado + B2B modelado · mesmo mês',chart(rows.map(r=>[r.month,r.b2cSignedCents,r.b2bSumMonthlyMinorUnits]),true)+'<div class="legend"><span>B2C observado</span><span class="blue">B2B modelado</span></div>','CENÁRIO','scenario')}${panel('Como consolidar com segurança','Uma sequência de decisões de negócio','<div class="quality-row"><span>1. Moeda B2B</span><strong>Confirmar</strong></div><div class="quality-row"><span>2. Vigência e substituições</span><strong>Homologar</strong></div><div class="quality-row"><span>3. Fluxo × recorrência</span><strong>Definir</strong></div><div class="quality-row"><span>4. Regra temporal comum</span><strong>Validar</strong></div><p class="note">A ausência dessas definições não impede o cenário. Impede tratá-lo como um indicador financeiro oficial.</p>','PENDENTE','scenario')}</div>${insight('O valor do modelo está na transparência das premissas.','A composição mostra como juntar as fontes em uma mesma janela sem ocultar o que não foi informado. O próximo passo comercial é validar as regras com o responsável pela carteira e, então, publicar o indicador homologado.')} ${panel('Memória de cálculo do cenário','Somas em centavos inteiros; status atual não é história',table(['Mês','B2C observado','B2B modelado','Composição','IDs elegíveis'],rows.map(r=>[monthLabel(r.month,true),money(r.b2cSignedCents),money(r.b2bSumMonthlyMinorUnits),money(r.combinedAssumedBrlCents),int(r.b2bContractCount)])),'CENÁRIO','scenario')}`;}
function renderArchitecture(){if(!architecture){view.innerHTML='<div class="loading">Preparando o fluxo…</div>';return;}const node=architecture.nodes.find(n=>n.id===selectedNode)??architecture.nodes[0];view.innerHTML=`<div class="architecture-intro"><p>Esta edição usa fontes inteiramente sintéticas geradas no processo local. Os parsers, as regras financeiras, o DTO e a interface são executáveis; o backend protegido do portal tem configuração separada.</p><span class="badge">ESTADO DA IMPLEMENTAÇÃO</span></div><div class="flow">${architecture.nodes.map(n=>`<button class="flow-node ${n.id===node.id?'selected':''}" data-node="${esc(n.id)}" aria-pressed="${n.id===node.id}"><span class="flow-index">${esc(n.step)} / ${esc(n.group)}</span><span class="node-arrow">↗</span><strong>${esc(n.title)}</strong><span class="flow-state"><span class="status-dot ${n.status==='pending'?'pending':''}"></span>${esc(n.statusLabel)}</span></button>`).join('')}</div><article class="panel flow-detail"><span class="eyebrow">ETAPA ${esc(node.step)}</span><h2 style="margin-top:12px">${esc(node.title)}</h2><p>${esc(node.explanation)}</p><h3>O que garante confiança</h3><ul>${node.guarantees.map(g=>`<li>${esc(g)}</li>`).join('')}</ul><details><summary>Ver detalhes técnicos e limites</summary><p>${esc(node.technical)}</p><div class="code-ref">${node.references.map(esc).join(' · ')}</div></details></article><p class="note">Este fluxo descreve a demonstração pública local. Não há coleta remota, automação, banco externo ou telemetria nesta edição. O portal protegido usa uma configuração privada separada.</p>`;}
function renderQuality(){const q=data.quality??{},s=data.manifest.sources??data.views.metadata.sources??[],b2c=q.b2c??{},b2b=q.b2b??{};view.innerHTML=`<div class="source-list">${s.map(source=>panel(source.sourceId==='b2c-csv'?'Fonte B2C · CSV sintético':'Fonte B2B · envelope sintético da API','Fonte sintética reproduzível por conteúdo',`<p class="source-info">Importação local: <strong>${esc(dateTime(source.localReadAt))}</strong><br>Referência factual da origem: <strong>${esc(source.sourceAsOf?'Informada':'Não informada')}</strong><br>Modo: <strong>${esc(source.mode??'não informado')}</strong></p><div class="source-hash">SHA-256<br>${esc(source.sha256)}</div>`,'PRESERVADO','observed')).join('')}</div><div class="two-columns">${panel('Qualidade B2C','Advertências ficam visíveis; linhas não são apagadas',`<div class="quality-row"><span>Linhas recebidas</span><strong>${int(b2c.rowCount??data.views.b2c.count)}</strong></div><div class="quality-row"><span>Advertências do tratamento</span><strong>${int(b2c.warningCount??0)}</strong></div><div class="quality-row"><span>Valores negativos</span><strong>${int(data.views.b2c.negativeCount)}</strong></div><div class="quality-row"><span>Valores zero</span><strong>${int(data.views.b2c.zeroCount)}</strong></div><p class="note">Linhas iguais são preservadas. Campos condicionais ausentes geram advertências, com evidência privada fora do navegador. Identidades de pessoas e linhas brutas não são enviadas à interface.</p>`)}${panel('Qualidade B2B','Completude e identidade do snapshot',`<div class="quality-row"><span>Contratos recebidos</span><strong>${int(b2b.rowCount??data.views.b2b.count)}</strong></div><div class="quality-row"><span>Moeda informada</span><strong>Não</strong></div><div class="quality-row"><span>Data factual de referência</span><strong>Não</strong></div><div class="quality-row"><span>Contrato repetido</span><strong>Impede publicar</strong></div><p class="note">A captura deve começar no offset zero e seu total deve coincidir com os registros recebidos. Uma coleta parcial não substitui a publicação válida.</p>`)}</div>${panel('Publicação e rastreabilidade','O navegador recebe agregados de uma única versão',`<div class="source-info">Versão: <strong>${esc(data.versionId)}</strong><br>Publicada em: <strong>${esc(dateTime(data.manifest.publishedAt))}</strong><br>Modo de execução: <strong>${esc(data.manifest.executionMode)}</strong><br>Fórmulas: <strong>${esc(data.manifest.viewFormulaVersion)}</strong></div><div class="note-box">Os horários acima documentam a leitura e a publicação local. Não indicam que a API ou a planilha foram atualizadas nessa data. A base B2C cobre janeiro de 2025 a julho de 2026; B2B não fornece source_as_of.</div><details><summary>Reuso e declaração de IA</summary><p>Esta edição pública contém os parsers, fórmulas, interface e exemplos de segurança escritos para o case. Os componentes privados de ingestão não fazem parte desta distribuição. Os dados são fictícios e determinísticos. Desenvolvimento assistido por IA; fórmulas e testes disponíveis para revisão.</p></details>`,'VERSÃO FIXADA','observed')}`;}
function render(){if(!data)return;updatePeriodUI();document.body.classList.toggle('presentation-page',page==='presentation');document.body.classList.toggle('presentation-mode',page==='presentation'&&presentationFocus);const h=headings[page];$('#mobile-page-name').textContent=pageNames[page];$('#eyebrow').textContent=h[0];$('#page-title').innerHTML=page==='b2c'?'Da venda à <span>decisão.</span>':esc(h[1]);$('#page-description').textContent=h[2];$('#period-control').hidden=!['b2c','total'].includes(page);document.querySelectorAll('[data-page]').forEach(b=>{b.classList.toggle('active',b.dataset.page===page);b.setAttribute('aria-current',b.dataset.page===page?'page':'false');});({b2c:renderB2C,b2b:renderB2B,total:renderTotal,architecture:renderArchitecture,quality:renderQuality,presentation:renderPresentation})[page]();updateTableScrollHints();$('#footer-version').textContent='Versão '+data.versionId.slice(0,8)+' · publicada em '+dateTime(data.manifest.publishedAt)+' · leitura de uma única publicação';}
function status(message,degraded=false){const c=$('#connection');c.textContent=message;c.classList.toggle('degraded',degraded);}
async function refresh(){if(loading)return;loading=true;$('#refresh').disabled=true;try{const r=await fetch('/api/dashboard',{cache:'no-store',signal:AbortSignal.timeout(15000)});if(r.status===401&&document.getElementById('logout')){location.assign('/');return;}if(!r.ok)throw new Error('READ_FAILED');const next=await r.json();if(!next.versionId||!next.views?.b2c)throw new Error('SCHEMA_INVALID');data=next;$('#version-label').textContent='PUBLICAÇÃO '+data.versionId.slice(0,8);status('DEMONSTRAÇÃO · dados 100% sintéticos. Atualizar leitura consulta a amostra local; não faz coleta externa.',false);if(data.attempt?.status && !['completed','replayed'].includes(data.attempt.status))status('Última tentativa: '+data.attempt.status+'. Exibindo a versão publicada em '+dateTime(data.manifest.publishedAt)+'.',true);render();}catch{status(data?'Leitura indisponível agora. A tela mantém a versão carregada em memória; os dados não foram atualizados.':'Não foi possível ler a publicação. Tente atualizar a leitura após conferir o estado da publicação.',true);if(!data)view.innerHTML='<div class="error-panel">A publicação não está disponível para leitura. A demonstração sintética não foi carregada. Use “Atualizar leitura” após conferir a publicação.</div>';}finally{loading=false;$('#refresh').disabled=false;}}
document.addEventListener('click',e=>{const nav=e.target.closest('[data-page]');if(nav){page=nav.dataset.page;location.hash=page;render();if(innerWidth<=800&&nav.closest('.sidebar')){setMobileNavigation(false);if(page!=='presentation')$('#toggle-navigation').focus({preventScroll:true});else $('.slide-title')?.focus({preventScroll:true});}}const node=e.target.closest('[data-node]');if(node){selectedNode=node.dataset.node;renderArchitecture();}const m=e.target.closest('[data-definition]');if(m){const d=defs[m.dataset.definition];if(d){$('#metric-title').textContent=d[0];$('#metric-description').textContent=d[1];$('#metric-version').textContent='Fórmula '+(data?.manifest?.viewFormulaVersion??'carregando')+' · versão '+(data?.versionId??'carregando');$('#metric-dialog').showModal();}}if(e.target.closest('#export-months')){const text=monthlyCsv(months());const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));a.href=url;const range=periodSelection($('#period').value,Object.keys(data.views.b2c.series.month));a.download='medway-b2c-'+range.start+'_'+range.end+'-'+data.versionId.slice(0,8)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}});
$('#close-dialog').addEventListener('click',()=>$('#metric-dialog').close());$('#metric-dialog').addEventListener('click',e=>{if(e.target===$('#metric-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});$('#period').addEventListener('change',render);$('#refresh').addEventListener('click',refresh);window.addEventListener('hashchange',()=>{readHash();render();});readHash();
const embedded=$('#medway-snapshot');
if(embedded){
  try{const saved=JSON.parse(embedded.textContent);data=saved.dashboard;architecture=saved.architecture;$('#version-label').textContent='CAPTURA '+data.versionId.slice(0,8);$('#refresh').disabled=true;$('#refresh').textContent='Captura fixa';status('Arquivo privado de uma publicação local · captura fixa. Para uma nova leitura do banco, execute o dashboard local.');render();}catch{view.innerHTML='<div class="error-panel">A captura local não pôde ser lida.</div>';}
}else{
  fetch('/api/architecture',{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject()).then(x=>{architecture=x;if(page==='architecture')render();}).catch(()=>{if(page==='architecture')view.innerHTML='<div class="error-panel">O manifesto da arquitetura não está disponível.</div>';});
  refresh();
}
document.getElementById('logout')?.addEventListener('click',async()=>{try{const r=await fetch('/auth/logout',{method:'POST',credentials:'same-origin'});if(!r.ok)throw new Error();location.assign('/');}catch{status('Não foi possível encerrar a sessão. Tente novamente.',true);}});

function readHash(){
  const [root,slide]=location.hash.slice(1).split('/');
  if(!headings[root])return;
  page=root;
  if(root==='presentation'&&/^\d+$/.test(slide??''))slideIndex=Number(slide);
}

// Navigation search and chart readouts use only the already loaded interface.
function showChartReadout(target) {
  const bar=target.closest?.('[data-chart-label]');if(!bar)return;
  const frame=bar.closest('.chart-frame'),tip=frame.querySelector('.chart-tooltip');
  tip.innerHTML=`<span>${esc(bar.dataset.chartLabel)}</span><strong>${esc(bar.dataset.chartValue)}</strong>`;
  tip.hidden=false;
  const b=bar.getBoundingClientRect(),f=frame.getBoundingClientRect();
  tip.style.left=Math.max(0,Math.min(f.width-tip.offsetWidth,b.left-f.left+b.width/2-tip.offsetWidth/2))+'px';
  tip.style.top=Math.max(0,b.top-f.top-tip.offsetHeight-9)+'px';
}
function hideChartReadout(target) { const frame=target.closest?.('.chart-frame');if(frame)frame.querySelector('.chart-tooltip').hidden=true; }
view.addEventListener('pointerover',e=>showChartReadout(e.target));
view.addEventListener('focusin',e=>showChartReadout(e.target));
view.addEventListener('pointerout',e=>hideChartReadout(e.target));
view.addEventListener('focusout',e=>hideChartReadout(e.target));
view.addEventListener('keydown',e=>{if(e.key==='Escape'){const tip=e.target.closest?.('.chart-frame')?.querySelector('.chart-tooltip');if(tip)tip.hidden=true;}});

const searchDialog=$('#search-dialog'),searchInput=$('#case-query');
function setMobileNavigation(open){$('.sidebar').classList.toggle('navigation-open',open);$('#toggle-navigation').setAttribute('aria-expanded',String(open));}
$('#toggle-navigation').addEventListener('click',()=>setMobileNavigation($('#toggle-navigation').getAttribute('aria-expanded')!=='true'));
$('.sidebar').addEventListener('keydown',e=>{if(e.key==='Escape'&&$('.sidebar').classList.contains('navigation-open')){setMobileNavigation(false);$('#toggle-navigation').focus();}});
const normalizeSearch=text=>String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function renderSearchResults(){
  if(data)comparison();
  const query=normalizeSearch(searchInput.value.trim());
  const names=pageNames;
  const routes=Object.entries(headings).filter(([id,row])=>normalizeSearch(names[id]+' '+row.join(' ')).includes(query)).map(([id,row])=>`<button class="search-result" data-page="${esc(id)}"><strong>${esc(names[id])}</strong><span>${esc(row[2])}</span></button>`);
  const definitions=Object.entries(defs).filter(([,row])=>normalizeSearch(row.join(' ')).includes(query)).map(([id,row])=>`<button class="search-result" data-definition="${esc(id)}"><strong>${esc(row[0])}</strong><span>Definição do indicador</span></button>`);
  $('#search-results').innerHTML=routes.concat(definitions).join('')||'<p class="search-hint">Nenhum resultado. Tente outro termo.</p>';
}
function openCaseSearch(){renderSearchResults();searchDialog.showModal();searchInput.focus();}
$('#open-search').addEventListener('click',openCaseSearch);
$('#close-search').addEventListener('click',()=>searchDialog.close());
searchInput.addEventListener('input',renderSearchResults);
searchDialog.addEventListener('click',e=>{if(e.target.closest('[data-page],[data-definition]'))searchDialog.close();});
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(!searchDialog.open&&!$('#period-dialog').open)openCaseSearch();}});
function renderPresentation(){
  const deck=buildPresentation(data);
  slideIndex=Math.min(Math.max(slideIndex,0),deck.slides.length-1);
  view.innerHTML=presentationMarkup(deck,slideIndex);
  const presentationBrand=$('.deck-brand'),officialLogo=$('.brand-logo');
  if(presentationBrand&&officialLogo)presentationBrand.innerHTML=officialLogo.outerHTML+'<small>SALES OPS / REVOPS</small>';
  view.querySelectorAll('.deck-chart:has(.deck-svg)').forEach(chart=>{chart.insertAdjacentHTML('afterbegin','<p class="deck-chart-scroll">Arraste o gráfico para consultar toda a comparação.</p>');});
  const focus=$('#presentation-focus');
  focus.textContent=presentationFocus?'Voltar':'Ampliar';
  focus.setAttribute('aria-pressed',String(presentationFocus));
}
function changeSlide(index){
  const count=buildPresentation(data).slides.length;
  slideIndex=Math.min(Math.max(index,0),count-1);
  const hash='presentation/'+slideIndex;
  history.replaceState(null,'','#'+hash);
  render();
  $('.slide-title')?.focus({preventScroll:true});
}
document.addEventListener('click',e=>{
  if(page!=='presentation'||!data)return;
  if(e.target.closest('#slide-prev'))changeSlide(slideIndex-1);
  if(e.target.closest('#slide-next'))changeSlide(slideIndex+1);
  if(e.target.closest('#presentation-focus')){
    presentationFocus=!presentationFocus;render();$('#presentation-focus')?.focus({preventScroll:true});
  }
});
document.addEventListener('change',e=>{
  if(page==='presentation'&&e.target.id==='slide-select')changeSlide(Number(e.target.value));
});
document.addEventListener('keydown',e=>{
  if(page!=='presentation'||!data||$('#metric-dialog').open||$('#search-dialog').open||e.altKey||e.ctrlKey||e.metaKey)return;
  if(e.target.matches('input,textarea,select,[contenteditable]'))return;
  const keys={ArrowRight:slideIndex+1,ArrowLeft:slideIndex-1,PageDown:slideIndex+1,PageUp:slideIndex-1,Home:0,End:buildPresentation(data).slides.length-1};
  if(Object.hasOwn(keys,e.key)){e.preventDefault();changeSlide(keys[e.key]);}
  if(e.key==='Escape'&&presentationFocus){presentationFocus=false;render();$('#presentation-focus')?.focus({preventScroll:true});}
});

let chartResizeTimer;window.addEventListener('resize',()=>{
  clearTimeout(chartResizeTimer);
  chartResizeTimer=setTimeout(()=>{
    updateTableScrollHints();
    if(!data||!['b2c','total'].includes(page))return;
    const frame=view.querySelector('.chart-frame');if(!frame)return;
    const focusedBar=frame.contains(document.activeElement)?document.activeElement.dataset.chartLabel:null;
    const rows=page==='b2c'?months().map(([m,x])=>[m,x.signedCents]):(data.views.total.monthlyComposition?.records??[]).filter(r=>matches(r.month)).map(r=>[r.month,r.b2cSignedCents,r.b2bSumMonthlyMinorUnits]);
    frame.outerHTML=chart(rows,page==='total');
    if(focusedBar){const next=[...view.querySelectorAll('[data-chart-label]')].find(b=>b.dataset.chartLabel===focusedBar);next?.focus({preventScroll:true});}
  },120);
});
