// Case-owned association adapter. Purchases are observations, not a lead funnel.
export const SEGMENT_FORMULA_VERSION = 'medway-purchase-associations-v1';
export const SEGMENT_PAIRS = Object.freeze({
  profileProduct: ['buyer_icp', 'product', null],
  profileChannel: ['buyer_icp', 'channel', null],
  channelProduct: ['channel', 'product', null],
  ambassadorProfile: ['ambassador', 'buyer_icp', 'Embaixador'],
  ambassadorProduct: ['ambassador', 'product', 'Embaixador'],
  eventProfile: ['event_type', 'buyer_icp', 'Evento Presencial'],
  eventRegionProduct: ['event_region', 'product', 'Evento Presencial'],
});
const empty = value => value == null || value === '' ? 'Não informado' : value;
export function buildSegmentArtifact({ records, versionId, sourceSha256, currencyDeclaration = null }) {
  const names = [...new Set(records.filter(r => r.channel === 'Embaixador' && r.ambassador).map(r => r.ambassador))].sort();
  const aliases = new Map(names.map((name, i) => {
    // Preserve the source's generic numeric label; do not reassign Embaixador 10
    // to Embaixador 02 merely because lexical sorting puts it second.
    const numbered = /^Embaixador ([0-9]{1,3})$/u.exec(name);
    return [name, numbered ? 'Embaixador ' + Number(numbered[1]) : 'Grupo anônimo ' + String(i + 1).padStart(2, '0')];
  }));
  const pairs = {};
  for (const [id, [left, right, channel]] of Object.entries(SEGMENT_PAIRS)) {
    const groups = new Map();
    for (const r of records) {
      if (r.amount_cents <= 0 || channel && r.channel !== channel) continue;
      const a = left === 'ambassador' ? aliases.get(r.ambassador) ?? 'Não informado' : empty(r[left]);
      const b = empty(r[right]);
      const key = JSON.stringify([r.month, a, b]);
      const cell = groups.get(key) ?? { count: 0, positiveCents: 0n };
      cell.count++; cell.positiveCents += BigInt(r.amount_cents); groups.set(key, cell);
    }
    pairs[id] = [...groups].sort(([a],[b]) => a.localeCompare(b)).map(([key, c]) => [...JSON.parse(key), c.count, String(c.positiveCents)]);
  }
  return { formulaVersion: SEGMENT_FORMULA_VERSION, versionId, sourceSha256,
    universe: 'positive-source-rows', identityPolicy: 'source-numbered-or-snapshot-anonymous-groups',
    currencyDeclaration, pairs };
}
export function segmentCompatible(artifact, dto) {
  return artifact?.formulaVersion === SEGMENT_FORMULA_VERSION && artifact.versionId === dto?.versionId
    && artifact.sourceSha256 === dto?.manifest?.sources?.find(s => s.sourceId === 'b2c-csv')?.sha256;
}
export function segmentMatrix(artifact, id, months) {
  if (!Object.hasOwn(SEGMENT_PAIRS, id) || !Array.isArray(artifact?.pairs?.[id])) throw new Error('SEGMENT_PAIR_INVALID');
  const chosen = new Set(months), groups = new Map();
  for (const [month, row, col, count, cents] of artifact.pairs[id]) {
    if (!chosen.has(month)) continue;
    const key = JSON.stringify([row, col]), cell = groups.get(key) ?? { row, col, count: 0, positiveCents: 0n };
    cell.count += count; cell.positiveCents += BigInt(cents); groups.set(key, cell);
  }
  const cells = [...groups.values()], rowTotals = {}, columnTotals = {};
  for (const c of cells) { rowTotals[c.row] = (rowTotals[c.row] ?? 0) + c.count; columnTotals[c.col] = (columnTotals[c.col] ?? 0) + c.count; }
  const total = cells.reduce((n,c) => n+c.count,0), rows = Object.keys(rowTotals).sort(), columns = Object.keys(columnTotals).sort();
  for (const c of cells) { c.share = c.count / rowTotals[c.row]; c.baseline = columnTotals[c.col] / total; c.lift = c.share / c.baseline; }
  // Descriptive effect size, with all zero cells included. No p-value or causal claim.
  let chiSquare = 0;
  for (const row of rows) for (const col of columns) {
    const observed = groups.get(JSON.stringify([row,col]))?.count ?? 0;
    const expected = rowTotals[row] * columnTotals[col] / total;
    if (expected) chiSquare += (observed-expected)**2/expected;
  }
  const dimension = Math.min(rows.length-1,columns.length-1);
  return { id, cells, rows, columns, rowTotals, columnTotals, total,
    cramersV: total && dimension > 0 ? Math.sqrt(chiSquare / (total*dimension)) : null };
}
