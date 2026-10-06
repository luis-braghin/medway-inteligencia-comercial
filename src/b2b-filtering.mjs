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
  // The dashboard renders all three B2B dimensions. Comparing status alone
  // allows a stale plan/region cube to pass when its status totals happen to
  // remain equal. Keep the comparison structural and exact for every map.
  return ['byStatus','byPlan','byRegion'].every(key=>sameSummaryMap(actual[key],expected[key]));
}
function sameSummaryMap(actual,expected) {
  if(!actual||!expected||typeof actual!=='object'||typeof expected!=='object'||Array.isArray(actual)||Array.isArray(expected))return false;
  const actualEntries=Object.entries(actual),expectedEntries=Object.entries(expected);
  return actualEntries.length===expectedEntries.length&&expectedEntries.every(([label,x])=>{
    const y=actual[label];
    if(!y||!x||y.count!==x.count||y.licenses!==x.licenses)return false;
    try{return BigInt(y.sumMonthlyMinorUnits)===BigInt(x.sumMonthlyMinorUnits);}catch{return false;}
  });
}
export function filterContractCube(artifact,filters={}) {
  const result={count:0,licenses:0,sumMonthlyMinorUnits:0n,byStatus:{},byPlan:{},byRegion:{}};
  for(const c of artifact.cells){
    if(['status','plan','region'].some(d=>{
      const value=filters[d];
      return value!==undefined&&value!==null&&value!=='all'&&c[d]!==value;
    }))continue;
    result.count+=c.count;result.licenses+=c.licenses;result.sumMonthlyMinorUnits+=BigInt(c.sumMonthlyMinorUnits);
    for(const [dimension,key] of [['status','byStatus'],['plan','byPlan'],['region','byRegion']]){
      const map=result[key],label=c[dimension];
      if(!Object.hasOwn(map,label))Object.defineProperty(map,label,{value:{count:0,licenses:0,sumMonthlyMinorUnits:0n},enumerable:true});
      map[label].count+=c.count;map[label].licenses+=c.licenses;map[label].sumMonthlyMinorUnits+=BigInt(c.sumMonthlyMinorUnits);
    }
  }
  return result;
}
