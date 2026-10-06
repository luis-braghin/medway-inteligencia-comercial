const TRANSFORMATION_VERSION = "medway-normalize-v1";
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

const B2C_HEADER = [
  "data_venda",
  "quarter",
  "origem",
  "embaixador",
  "tipo_evento",
  "regiao_evento",
  "produto",
  "icp_comprador",
  "cupom",
  "valor_pago",
];

const B2C_FIELDS = {
  quarter: ["Q1", "Q2", "Q3", "Q4"],
  channel: ["Orgânico", "Evento Presencial", "Indicação Direta", "Embaixador"],
  event_type: ["Encontro Local", "Palestra Faculdade", "Congresso", "Workshop Regional", "Aula Aberta"],
  event_region: ["SP", "SUL", "RJ", "MG", "NE"],
  product: ["Extensivo R1", "Extensivo R+", "Curso Avulso", "Extensivo Programado 2", "Extensivo Programado 1"],
  buyer_icp: ["Recém-formado", "6º ano", "5º ano", "Formado R+", "4º ano"],
};

const B2B_FIELDS = [
  "contract_id",
  "institution",
  "institution_type",
  "region",
  "plan",
  "product",
  "licenses",
  "monthly_minor_units",
  "currency",
  "start_date",
  "status",
  "raw",
];
const B2B_STATUS = ["ativo", "pausado", "churn"];
const B2B_REGIONS = ["SP", "CO", "SUL", "N", "NE", "RJ", "MG"];

class NormalizationError extends Error {
  constructor(message) {
    super(message);
    this.name = "NormalizationError";
  }
}

function fail(message) {
  throw new NormalizationError(message);
}

function requireSnapshotHash(snapshotSha256) {
  if (typeof snapshotSha256 !== "string" || !/^[0-9a-f]{64}$/iu.test(snapshotSha256)) {
    fail("snapshotSha256 must be a 64-character hexadecimal SHA-256");
  }
  return snapshotSha256;
}

function emptyQuality(source, snapshotSha256) {
  return {
    source,
    source_snapshot_sha256: snapshotSha256,
    transformation_version: TRANSFORMATION_VERSION,
    row_count: 0,
    warning_count: 0,
    warnings: [],
    aliases: [],
    unknown_values: Object.create(null),
    replacement_character_count: 0,
    replacement_locations: [],
    duplicate_policy: source === "b2c" ? "preserve_all_rows" : "reject_duplicate_contract_id",
  };
}

function addWarning(quality, code, location = {}) {
  quality.warnings.push({ code, ...location });
  quality.warning_count = quality.warnings.length;
}

function addAlias(quality, field, rawValue, normalizedValue, sourceRow) {
  if (rawValue === normalizedValue || rawValue === "" || normalizedValue == null) return;
  const existing = quality.aliases.find(
    (item) => item.field === field && item.raw === rawValue && item.normalized === normalizedValue,
  );
  if (existing) {
    existing.source_rows.push(sourceRow);
    return;
  }
  quality.aliases.push({ field, raw: rawValue, normalized: normalizedValue, source_rows: [sourceRow] });
}

function countReplacementCharacters(value) {
  if (typeof value !== "string") return 0;
  return [...value].filter((character) => character === "\ufffd").length;
}

function markReplacementCharacters(quality, value, location) {
  const count = countReplacementCharacters(value);
  if (count === 0) return;
  quality.replacement_character_count += count;
  quality.replacement_locations.push(location);
}

function collapseSpaces(value) {
  return value.trim().replace(/\s+/g, " ");
}

function folded(value) {
  return collapseSpaces(value).toLocaleLowerCase("pt-BR");
}

function normalizeKnown(value, field, knownValues, quality, sourceRow) {
  if (value == null) return null;
  if (typeof value !== "string") fail(`invalid ${field} at source row ${sourceRow}`);
  const normalizedSpaces = collapseSpaces(value);
  if (normalizedSpaces === "") return null;
  const match = knownValues.find((candidate) => folded(candidate) === folded(normalizedSpaces));
  const normalized = match ?? normalizedSpaces;
  addAlias(quality, field, value, normalized, sourceRow);
  if (match == null) {
    const counts = quality.unknown_values[field] ?? Object.create(null);
    counts[normalized] = (counts[normalized] ?? 0) + 1;
    quality.unknown_values[field] = counts;
    addWarning(quality, "unknown_category", { field, source_row: sourceRow });
  }
  return normalized;
}

function normalizeFreeText(value, field, quality, sourceRow) {
  if (typeof value !== "string") fail(`invalid ${field} at source row ${sourceRow}`);
  const normalized = collapseSpaces(value);
  addAlias(quality, field, value, normalized || null, sourceRow);
  return normalized === "" ? null : normalized;
}

function validateDateText(value, context, allowBrazilian) {
  if (typeof value !== "string") fail(`invalid date at ${context}`);
  const input = value.trim();
  let year;
  let month;
  let day;
  if (allowBrazilian && /^\d{2}\/\d{2}\/\d{4}$/.test(input)) {
    [day, month, year] = input.split("/").map(Number);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    [year, month, day] = input.split("-").map(Number);
  } else {
    fail(`invalid date at ${context}`);
  }
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    !Number.isFinite(candidate.getTime()) ||
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    fail(`invalid date at ${context}`);
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function toSafeNumber(value, context) {
  if (value < -MAX_SAFE_BIGINT || value > MAX_SAFE_BIGINT) {
    fail(`integer out of safe range at ${context}`);
  }
  return Number(value);
}

function parseInteger(value, context, { min = null } = {}) {
  let integer;
  if (typeof value === "bigint") {
    integer = value;
  } else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail(`invalid integer at ${context}`);
    integer = BigInt(value);
  } else if (typeof value === "string" && /^[+-]?\d+$/.test(value.trim())) {
    try {
      integer = BigInt(value.trim());
    } catch {
      fail(`invalid integer at ${context}`);
    }
  } else {
    fail(`invalid integer at ${context}`);
  }
  if (min != null && integer < BigInt(min)) fail(`invalid integer at ${context}`);
  return integer;
}

function parseMoneyCents(value, context) {
  if (typeof value !== "string") fail(`invalid amount at ${context}`);
  let input = value.trim().replace(/\u00a0/g, " ");
  let sign = 1n;
  if (input.startsWith("+")) input = input.slice(1).trimStart();
  else if (input.startsWith("-")) {
    sign = -1n;
    input = input.slice(1).trimStart();
  }
  if (/^R\$\s*/i.test(input)) input = input.replace(/^R\$\s*/i, "");
  if (!input || /\s/.test(input) || !/^[0-9.,]+$/.test(input)) fail(`invalid amount at ${context}`);

  const commaCount = (input.match(/,/g) ?? []).length;
  const dotCount = (input.match(/\./g) ?? []).length;
  let decimalSeparator = null;
  let thousandsSeparator = null;
  if (commaCount && dotCount) {
    decimalSeparator = input.lastIndexOf(",") > input.lastIndexOf(".") ? "," : ".";
    thousandsSeparator = decimalSeparator === "," ? "." : ",";
  } else if (commaCount) {
    if (commaCount === 1 && /^\d+,\d{1,2}$/.test(input)) decimalSeparator = ",";
    else if (/^\d{1,3}(?:,\d{3})+$/.test(input)) thousandsSeparator = ",";
    else fail(`invalid amount at ${context}`);
  } else if (dotCount) {
    if (dotCount === 1 && /^\d+\.\d{1,2}$/.test(input)) decimalSeparator = ".";
    else if (/^\d{1,3}(?:\.\d{3})+$/.test(input)) thousandsSeparator = ".";
    else fail(`invalid amount at ${context}`);
  }

  let integerPart = input;
  let fractionPart = "";
  if (decimalSeparator != null) {
    const parts = input.split(decimalSeparator);
    if (parts.length !== 2 || !/^\d{1,2}$/.test(parts[1])) fail(`invalid amount at ${context}`);
    integerPart = parts[0];
    fractionPart = parts[1];
  }
  if (thousandsSeparator != null) {
    const groups = integerPart.split(thousandsSeparator);
    if (!/^\d{1,3}$/.test(groups[0]) || groups.slice(1).some((group) => !/^\d{3}$/.test(group))) {
      fail(`invalid amount at ${context}`);
    }
    integerPart = groups.join("");
  }
  if (!/^\d+$/.test(integerPart)) fail(`invalid amount at ${context}`);
  const cents = sign * (BigInt(integerPart) * 100n + BigInt((fractionPart + "00").slice(0, 2)));
  return toSafeNumber(cents, context);
}

function parseCsvRecords(csvText) {
  if (typeof csvText !== "string") fail("B2C CSV must be a string");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let afterClosingQuote = false;
  let sawToken = false;

  const pushRecord = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = "";
    afterClosingQuote = false;
    sawToken = false;
  };

  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index];
    if (inQuotes) {
      if (character === '"') {
        if (csvText[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          afterClosingQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (afterClosingQuote) {
      if (character === ",") {
        row.push(field);
        field = "";
        afterClosingQuote = false;
        sawToken = true;
      } else if (character === "\r" || character === "\n") {
        pushRecord();
        if (character === "\r" && csvText[index + 1] === "\n") index += 1;
      } else {
        fail("invalid B2C CSV quote termination");
      }
      continue;
    }
    if (character === '"') {
      if (field !== "") fail("invalid B2C CSV quote placement");
      inQuotes = true;
      sawToken = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
      sawToken = true;
    } else if (character === "\r" || character === "\n") {
      // A final line break is a terminator, not an extra blank record.
      if (row.length > 0 || field !== "" || sawToken || index + 1 < csvText.length) pushRecord();
      if (character === "\r" && csvText[index + 1] === "\n") index += 1;
    } else {
      field += character;
      sawToken = true;
    }
  }
  if (inQuotes) fail("unterminated B2C CSV quote");
  if (row.length > 0 || field !== "" || sawToken) pushRecord();
  return rows;
}

function requiredText(value, field, context) {
  if (typeof value !== "string" || value.trim() === "") fail(`missing ${field} at ${context}`);
  return value;
}

function updateReplacementQuality(quality, raw, sourceRow) {
  for (const [field, value] of Object.entries(raw)) {
    markReplacementCharacters(quality, value, { source_row: sourceRow, field });
  }
}

function finalizeB2CQuality(quality, records) {
  const amounts = records.map((record) => record.amount_cents);
  const signed = amounts.reduce((sum, amount) => sum + BigInt(amount), 0n);
  const positive = amounts.filter((amount) => amount > 0);
  const negative = amounts.filter((amount) => amount < 0);
  const zero = amounts.filter((amount) => amount === 0);
  const toNumber = (value) => toSafeNumber(value, "B2C quality total");
  quality.row_count = records.length;
  quality.counts = {
    positive: positive.length,
    negative: negative.length,
    zero: zero.length,
  };
  quality.amounts = {
    signed_cents: toNumber(signed),
    positive_cents: toNumber(positive.reduce((sum, amount) => sum + BigInt(amount), 0n)),
    negative_cents: toNumber(negative.reduce((sum, amount) => sum + BigInt(amount), 0n)),
    zero_cents: toNumber(zero.reduce((sum, amount) => sum + BigInt(amount), 0n)),
  };
  return quality;
}

function canonicalB2B(value, field, known, quality, sourceRow) {
  return normalizeKnown(value, field, known, quality, sourceRow);
}

function finalizeB2BQuality(quality, records, declaredTotal) {
  quality.row_count = records.length;
  quality.declared_total = declaredTotal;
  quality.status_counts = Object.create(null);
  const licenseTotals = Object.create(null);
  const monthlyTotals = Object.create(null);
  for (const record of records) {
    const status = record.status;
    quality.status_counts[status] = (quality.status_counts[status] ?? 0) + 1;
    licenseTotals[status] = (licenseTotals[status] ?? 0n) + BigInt(record.licenses);
    monthlyTotals[status] = (monthlyTotals[status] ?? 0n) + BigInt(record.monthly_minor_units);
  }
  const exactAggregate = (value, context) =>
    value < -MAX_SAFE_BIGINT || value > MAX_SAFE_BIGINT ? value.toString() : toSafeNumber(value, context);
  quality.licenses_by_status = Object.create(null);
  quality.monthly_minor_units_by_status = Object.create(null);
  for (const status of Object.keys(licenseTotals)) {
    quality.licenses_by_status[status] = exactAggregate(licenseTotals[status], `B2B ${status} licenses total`);
    quality.monthly_minor_units_by_status[status] = exactAggregate(monthlyTotals[status], `B2B ${status} monthly total`);
  }
  return quality;
}

export function normalizeB2C(csvText, snapshotSha256) {
  const snapshot = requireSnapshotHash(snapshotSha256);
  const rows = parseCsvRecords(csvText);
  if (rows.length === 0) fail("B2C CSV header is missing");
  const header = [...rows[0]];
  if (header[0]?.startsWith("\ufeff")) header[0] = header[0].slice(1);
  if (header.length !== B2C_HEADER.length || header.some((value, index) => value !== B2C_HEADER[index])) {
    fail("B2C CSV header mismatch");
  }

  const quality = emptyQuality("b2c", snapshot);
  const records = [];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const sourceRow = rowIndex + 1; // CSV header is line/ordinal 1.
    const row = rows[rowIndex];
    if (row.length !== B2C_HEADER.length) fail(`invalid B2C CSV row width at source row ${sourceRow}`);
    const raw = Object.fromEntries(B2C_HEADER.map((field, index) => [field, row[index]]));
    updateReplacementQuality(quality, raw, sourceRow);

    const dateRaw = requiredText(raw.data_venda, "data_venda", `source row ${sourceRow}`);
    const date = validateDateText(dateRaw, `B2C source row ${sourceRow}`, true);
    const dateObject = new Date(`${date}T00:00:00Z`);
    const expectedQuarter = `Q${Math.floor(dateObject.getUTCMonth() / 3) + 1}`;
    const quarter = normalizeKnown(raw.quarter, "quarter", B2C_FIELDS.quarter, quality, sourceRow);
    if (quarter == null) fail(`missing quarter at source row ${sourceRow}`);
    if (quarter !== expectedQuarter) addWarning(quality, "quarter_date_mismatch", { source_row: sourceRow });

    const channel = normalizeKnown(raw.origem, "channel", B2C_FIELDS.channel, quality, sourceRow);
    if (channel == null) fail(`missing channel at source row ${sourceRow}`);
    const ambassador = normalizeKnown(raw.embaixador, "ambassador", [
      ...Array.from({ length: 20 }, (_, index) => `Embaixador ${String(index + 1).padStart(2, "0")}`),
    ], quality, sourceRow);
    const eventType = normalizeKnown(raw.tipo_evento, "event_type", B2C_FIELDS.event_type, quality, sourceRow);
    const eventRegion = normalizeKnown(raw.regiao_evento, "event_region", B2C_FIELDS.event_region, quality, sourceRow);
    const product = requiredText(raw.produto, "product", `source row ${sourceRow}`);
    const buyerIcp = requiredText(raw.icp_comprador, "buyer_icp", `source row ${sourceRow}`);
    const coupon = requiredText(raw.cupom, "coupon", `source row ${sourceRow}`);
    const amountCents = parseMoneyCents(raw.valor_pago, `B2C source row ${sourceRow}`);

    const normalizedProduct = normalizeKnown(product, "product", B2C_FIELDS.product, quality, sourceRow);
    const normalizedBuyerIcp = normalizeKnown(buyerIcp, "buyer_icp", B2C_FIELDS.buyer_icp, quality, sourceRow);
    const normalizedCoupon = normalizeFreeText(coupon, "coupon", quality, sourceRow);
    if (channel === "Evento Presencial" && (eventType == null || eventRegion == null)) {
      addWarning(quality, "missing_conditional_event_field", { source_row: sourceRow });
    }
    if (channel === "Embaixador" && ambassador == null) {
      addWarning(quality, "missing_conditional_ambassador", { source_row: sourceRow });
    }
    if (channel !== "Evento Presencial" && (eventType != null || eventRegion != null)) {
      addWarning(quality, "non_event_with_event_field", { source_row: sourceRow });
    }
    if (channel !== "Embaixador" && ambassador != null) {
      addWarning(quality, "non_ambassador_with_identity", { source_row: sourceRow });
    }

    records.push({
      record_key: `b2c:${snapshot}:${sourceRow}`,
      source_snapshot_sha256: snapshot,
      transformation_version: TRANSFORMATION_VERSION,
      source_row: sourceRow,
      date,
      month: date.slice(0, 7),
      quarter_year: `${date.slice(0, 4)}-${expectedQuarter}`,
      channel,
      ambassador,
      event_type: eventType,
      event_region: eventRegion,
      product: normalizedProduct,
      buyer_icp: normalizedBuyerIcp,
      coupon: normalizedCoupon,
      amount_cents: amountCents,
      raw,
    });
  }
  finalizeB2CQuality(quality, records);
  return { records, quality };
}

export function normalizeB2B(jsonText, snapshotSha256) {
  const snapshot = requireSnapshotHash(snapshotSha256);
  if (typeof jsonText !== "string") fail("B2B JSON must be a string");
  let payload;
  try {
    payload = JSON.parse(jsonText);
  } catch {
    fail("invalid B2B JSON");
  }
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) fail("invalid B2B envelope");
  const declaredTotal = toSafeNumber(parseInteger(payload.total, "B2B total", { min: 0 }), "B2B total");
  const offset = toSafeNumber(parseInteger(payload.offset, "B2B offset", { min: 0 }), "B2B offset");
  parseInteger(payload.limit, "B2B limit", { min: 1 });
  if (offset !== 0) fail("B2B snapshot must start at offset zero");
  if (!Array.isArray(payload.contratos)) fail("B2B contratos must be an array");
  if (payload.contratos.length !== declaredTotal) fail("B2B total does not match contratos length");

  const quality = emptyQuality("b2b", snapshot);
  const records = [];
  const seenIds = new Set();
  for (let index = 0; index < payload.contratos.length; index += 1) {
    const sourceRow = index + 1;
    const contract = payload.contratos[index];
    if (contract == null || typeof contract !== "object" || Array.isArray(contract)) {
      fail(`invalid B2B contract at source row ${sourceRow}`);
    }
    const raw = { ...contract };
    updateReplacementQuality(quality, raw, sourceRow);
    const idRaw = requiredText(raw.id_contrato, "id_contrato", `B2B source row ${sourceRow}`);
    const contractId = normalizeFreeText(idRaw, "contract_id", quality, sourceRow);
    if (seenIds.has(contractId)) fail(`duplicate B2B contract_id at source row ${sourceRow}`);
    seenIds.add(contractId);

    const institution = normalizeFreeText(requiredText(raw.instituicao, "instituicao", `B2B source row ${sourceRow}`), "institution", quality, sourceRow);
    const institutionType = normalizeFreeText(requiredText(raw.tipo, "tipo", `B2B source row ${sourceRow}`), "institution_type", quality, sourceRow);
    const region = canonicalB2B(requiredText(raw.regiao, "regiao", `B2B source row ${sourceRow}`), "region", B2B_REGIONS, quality, sourceRow);
    const plan = normalizeFreeText(requiredText(raw.plano, "plano", `B2B source row ${sourceRow}`), "plan", quality, sourceRow);
    const product = normalizeFreeText(requiredText(raw.produto, "produto", `B2B source row ${sourceRow}`), "product", quality, sourceRow);
    const licenses = toSafeNumber(parseInteger(raw.num_licencas, `B2B source row ${sourceRow} licenses`, { min: 1 }), `B2B source row ${sourceRow} licenses`);
    const monthlyBase = parseInteger(raw.valor_mensal, `B2B source row ${sourceRow} monthly value`, { min: 0 });
    const monthlyMinorUnits = toSafeNumber(monthlyBase * 100n, `B2B source row ${sourceRow} monthly value`);
    const startRaw = requiredText(raw.data_inicio, "data_inicio", `B2B source row ${sourceRow}`);
    const startDate = validateDateText(startRaw, `B2B source row ${sourceRow}`, false);
    const status = canonicalB2B(requiredText(raw.status, "status", `B2B source row ${sourceRow}`), "status", B2B_STATUS, quality, sourceRow);
    if (!B2B_STATUS.includes(status)) fail(`unknown B2B status at source row ${sourceRow}`);

    records.push({
      record_key: `b2b:${snapshot}:${contractId}`,
      source_snapshot_sha256: snapshot,
      transformation_version: TRANSFORMATION_VERSION,
      contract_id: contractId,
      institution,
      institution_type: institutionType,
      region,
      plan,
      product,
      licenses,
      monthly_minor_units: monthlyMinorUnits,
      currency: null,
      start_date: startDate,
      status,
      raw,
    });
  }
  finalizeB2BQuality(quality, records, declaredTotal);
  return { records, quality };
}
