// Anonymous cross-dimensional aggregates; no contract IDs or institution names.
export function buildContractCube({records,versionId,sourceSha256}) {
  const groups=new Map();
  for(const r of records){
    const dims=[r.status,r.plan,r.region],key=JSON.stringify(dims);
    if(!groups.has(key))groups.set(key,{status:dims[0],plan:dims[1],region:dims[2],count:0,licenses:0,sumMonthlyMinorUnits:0n});
    const cell=groups.get(key);cell.count++;cell.licenses+=r.licenses;cell.sumMonthlyMinorUnits+=BigInt(r.monthly_minor_units);
  }
  return {versionId,sourceSha256,cells:[...groups.values()].map(c=>({...c,sumMonthlyMinorUnits:String(c.sumMonthlyMinorUnits)}))};
}
export function contractCubeCompatible(artifact,publication) {
  if(!artifact||artifact.versionId!==publication?.versionId)return false;
  const source=(publication.manifest?.sources??[]).find(s=>s.sourceId==='b2b-json');
  if(source?.sha256!==artifact.sourceSha256)return false;
  const actual=filterContractCube(artifact),expected=publication.views?.b2b;
  if(!expected||actual.count!==expected.count)return false;
  const entries=Object.entries(expected.byStatus??{});
  return entries.length===Object.keys(actual.byStatus).length&&entries.every(([status,x])=>{
    const y=actual.byStatus[status];return y&&y.count===x.count&&y.licenses===x.licenses&&BigInt(y.sumMonthlyMinorUnits)===BigInt(x.sumMonthlyMinorUnits);
  });
}
export function filterContractCube(artifact,filters={}) {
  const result={count:0,licenses:0,sumMonthlyMinorUnits:0n,byStatus:{},byPlan:{},byRegion:{}};
  for(const c of artifact.cells){
    if(['status','plan','region'].some(d=>filters[d]&&filters[d]!=='all'&&c[d]!==filters[d]))continue;
    result.count+=c.count;result.licenses+=c.licenses;result.sumMonthlyMinorUnits+=BigInt(c.sumMonthlyMinorUnits);
    for(const [dimension,key] of [['status','byStatus'],['plan','byPlan'],['region','byRegion']]){
      const map=result[key],label=c[dimension];
      if(!Object.hasOwn(map,label))Object.defineProperty(map,label,{value:{count:0,licenses:0,sumMonthlyMinorUnits:0n},enumerable:true});
      map[label].count+=c.count;map[label].licenses+=c.licenses;map[label].sumMonthlyMinorUnits+=BigInt(c.sumMonthlyMinorUnits);
    }
  }
  return result;
}
