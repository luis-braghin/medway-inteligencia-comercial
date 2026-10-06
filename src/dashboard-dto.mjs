// Pure dashboard DTO sanitization; intentionally has no Node or filesystem imports.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_RE = /^[a-f0-9]{64}$/u;
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;
const MONTH_RE = /^\d{4}-(?:0[1-9]|1[0-2])$/u;
const INTEGER_TEXT_RE = /^[+-]?\d+$/u;
const SAFE_TEXT_RE = /^[^\u0000-\u001f\u007f\u0080-\u009f]{1,512}$/u;
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,160}$/u;
const ERROR_CODE_RE = /^[A-Z][A-Z0-9_]{2,80}$/u;
const LOCAL_EXECUTION_MODE = 'local-frozen-snapshots';
const EXECUTION_MODES = new Set([LOCAL_EXECUTION_MODE, 'supabase-csv-api-snapshots', 'supabase-frozen-snapshots']);
const LOCAL_SOURCE_IDS = new Set(['b2c-csv', 'b2b-json']);
const LOCAL_SOURCE_MODE = 'frozen-local-snapshot';

const ATTEMPT_STATUSES = new Set(['running', 'completed', 'replayed', 'failed', 'in_doubt', 'publication_pending']);
const WARNING_CODES = new Set([
  'unknown_category',
  'quarter_date_mismatch',
  'missing_conditional_event_field',
  'missing_conditional_ambassador',
  'non_event_with_event_field',
  'non_ambassador_with_identity',
]);

const ACCUMULATOR_KEYS = [
  'count',
  'positiveCount',
  'negativeCount',
  'zeroCount',
  'signedCents',
  'positiveCents',
  'negativeCents',
  'zeroCents',
];

function codeError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function object(value, context) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw codeError('DASHBOARD_BUNDLE_INVALID', `${context} must be an object`);
  }
  return value;
}

function optionalObject(value, context) {
  if (value === undefined || value === null) return null;
  return object(value, context);
}

function safeText(value, context, { max = 512, nullable = true } = {}) {
  if (value === undefined || value === null) {
    if (nullable) return null;
    throw codeError('DASHBOARD_BUNDLE_INVALID', `${context} is required`);
  }
  if (typeof value !== 'string' || value.length === 0 || value.length > max || !SAFE_TEXT_RE.test(value)) {
    throw codeError('DASHBOARD_BUNDLE_INVALID', `${context} is invalid`);
  }
  return value;
}

function optionalText(value, context, options = {}) {
  if (value === undefined || value === null) return null;
  try {
    return safeText(value, context, options);
  } catch {
    return null;
  }
}

function requiredUuid(value, context) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw codeError('DASHBOARD_BUNDLE_INVALID', `${context} is not a UUID`);
  }
  return value.toLowerCase();
}

function optionalTimestamp(value, context, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw codeError('DASHBOARD_BUNDLE_INVALID', `${context} is required`);
    return null;
  }
  if (typeof value !== 'string' || !ISO_TIMESTAMP_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw codeError('DASHBOARD_BUNDLE_INVALID', `${context} is not an ISO timestamp`);
  }
  return value;
}

function optionalInteger(value, context, { nonNegative = true } = {}) {
  if (value === undefined || value === null) return undefined;
  if (!Number.isSafeInteger(value) || (nonNegative && value < 0)) {
    throw codeError('DASHBOARD_BUNDLE_INVALID', `${context} is not a safe integer`);
  }
  return value;
}

function optionalIntegerText(value, context) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > 80 || !INTEGER_TEXT_RE.test(value)) {
    throw codeError('DASHBOARD_BUNDLE_INVALID', `${context} is not an integer string`);
  }
  return value;
}

function optionalBoolean(value, context) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw codeError('DASHBOARD_BUNDLE_INVALID', `${context} is not boolean`);
  return value;
}

function pickOptional(target, source, key, transform) {
  const value = transform(source[key], `${key}`);
  if (value !== undefined) target[key] = value;
}

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function pickRequired(target, source, key, transform, context) {
  if (!hasOwn(source, key)) {
    throw codeError('DASHBOARD_BUNDLE_INVALID', `${context}.${key} is required`);
  }
  const value = transform(source[key], `${context}.${key}`);
  if (value === undefined) {
    throw codeError('DASHBOARD_BUNDLE_INVALID', `${context}.${key} is required`);
  }
  target[key] = value;
}

function dimensionKey(value, context, { month = false } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 160 || !SAFE_TEXT_RE.test(value)) {
    throw codeError('DASHBOARD_BUNDLE_INVALID', `${context} is invalid`);
  }
  if (month && !MONTH_RE.test(value)) {
    throw codeError('DASHBOARD_BUNDLE_INVALID', `${context} is not YYYY-MM`);
  }
  return value;
}

function sortedEntries(value, context) {
  const source = object(value, context);
  return Object.entries(source).sort(([left], [right]) => left.localeCompare(right));
}

function sanitizeTicket(value, context) {
  if (value === undefined || value === null) return undefined;
  const source = object(value, context);
  const result = {};
  if (source.universe !== undefined) result.universe = safeText(source.universe, `${context}.universe`, { max: 80, nullable: false });
  pickOptional(result, source, 'numeratorCents', optionalIntegerText);
  pickOptional(result, source, 'denominator', optionalInteger);
  pickOptional(result, source, 'denominatorCount', optionalInteger);
  if (source.exactRatio !== undefined && source.exactRatio !== null) {
    const ratio = object(source.exactRatio, `${context}.exactRatio`);
    const sanitizedRatio = {};
    pickOptional(sanitizedRatio, ratio, 'numeratorCents', optionalIntegerText);
    pickOptional(sanitizedRatio, ratio, 'denominator', optionalInteger);
    result.exactRatio = sanitizedRatio;
  } else if (source.exactRatio === null) {
    result.exactRatio = null;
  }
  return result;
}

function sanitizeAccumulator(value, context) {
  const source = object(value, context);
  const result = {};
  for (const key of ACCUMULATOR_KEYS) {
    const transform = key === 'count' || key.endsWith('Count')
      ? optionalInteger
      : optionalIntegerText;
    pickRequired(result, source, key, transform, context);
  }
  const ticket = sanitizeTicket(source.ticket, `${context}.ticket`);
  if (ticket !== undefined) result.ticket = ticket;
  const count = BigInt(result.count);
  const positiveCount = BigInt(result.positiveCount);
  const negativeCount = BigInt(result.negativeCount);
  const zeroCount = BigInt(result.zeroCount);
  const positiveCents = BigInt(result.positiveCents);
  const negativeCents = BigInt(result.negativeCents);
  const zeroCents = BigInt(result.zeroCents);
  const signedCents = BigInt(result.signedCents);
  if (count !== positiveCount + negativeCount + zeroCount
    || signedCents !== positiveCents + negativeCents + zeroCents
    || positiveCents < 0n || negativeCents > 0n || zeroCents !== 0n) {
    throw codeError('DASHBOARD_BUNDLE_INVALID', `${context} arithmetic is inconsistent`);
  }
  if (ticket !== undefined) {
    if (ticket.numeratorCents !== undefined && BigInt(ticket.numeratorCents) !== positiveCents) {
      throw codeError('DASHBOARD_BUNDLE_INVALID', `${context}.ticket numerator is inconsistent`);
    }
    if (ticket.denominator !== undefined && ticket.denominator !== result.positiveCount) {
      throw codeError('DASHBOARD_BUNDLE_INVALID', `${context}.ticket denominator is inconsistent`);
    }
    if (ticket.denominatorCount !== undefined && ticket.denominatorCount !== result.positiveCount) {
      throw codeError('DASHBOARD_BUNDLE_INVALID', `${context}.ticket denominatorCount is inconsistent`);
    }
    if (ticket.exactRatio) {
      if (ticket.exactRatio.numeratorCents !== undefined && BigInt(ticket.exactRatio.numeratorCents) !== positiveCents) {
        throw codeError('DASHBOARD_BUNDLE_INVALID', `${context}.ticket ratio numerator is inconsistent`);
      }
      if (ticket.exactRatio.denominator !== undefined && ticket.exactRatio.denominator !== result.positiveCount) {
        throw codeError('DASHBOARD_BUNDLE_INVALID', `${context}.ticket ratio denominator is inconsistent`);
      }
    }
  }
  return result;
}

function sanitizeAggregateMap(value, context, { month = false } = {}) {
  if (value === undefined || value === null) return {};
  return Object.fromEntries(sortedEntries(value, context).map(([key, entry]) => [
    dimensionKey(key, `${context}.${key}`, { month }),
    sanitizeAccumulator(entry, `${context}.${key}`),
  ]));
}

function sanitizeMonthlyAggregateMap(value, context) {
  if (value === undefined || value === null) return {};
  return Object.fromEntries(sortedEntries(value, context).map(([month, categories]) => [
    dimensionKey(month, `${context}.${month}`, { month }),
    sanitizeAggregateMap(categories, `${context}.${month}`),
  ]));
}

function sanitizeWindow(value, context) {
  const source = optionalObject(value, context);
  if (!source) return {};
  const result = {};
  if (source.minMonth !== undefined && source.minMonth !== null) result.minMonth = dimensionKey(source.minMonth, `${context}.minMonth`, { month: true });
  else if (source.minMonth === null) result.minMonth = null;
  if (source.maxMonth !== undefined && source.maxMonth !== null) result.maxMonth = dimensionKey(source.maxMonth, `${context}.maxMonth`, { month: true });
  else if (source.maxMonth === null) result.maxMonth = null;
  pickOptional(result, source, 'monthsB2C', optionalInteger);
  return result;
}

function sanitizeB2C(value) {
  const source = object(value, 'views.b2c');
  const result = sanitizeAccumulator(source, 'views.b2c');
  if (source.currency !== undefined) result.currency = optionalText(source.currency, 'views.b2c.currency', { max: 16 });
  result.window = sanitizeWindow(source.window, 'views.b2c.window');
  const seriesSource = optionalObject(source.series, 'views.b2c.series') ?? {};
  const series = {
    month: sanitizeAggregateMap(seriesSource.month, 'views.b2c.series.month', { month: true }),
    channel: sanitizeAggregateMap(seriesSource.channel, 'views.b2c.series.channel'),
    product: sanitizeAggregateMap(seriesSource.product, 'views.b2c.series.product'),
  };
  // Keep absent V1 maps absent so the renderer can use its documented
  // channel/product fallback. A present map is still sanitized strictly.
  if (seriesSource.monthChannel !== undefined && seriesSource.monthChannel !== null) {
    series.monthChannel = sanitizeMonthlyAggregateMap(seriesSource.monthChannel, 'views.b2c.series.monthChannel');
  }
  if (seriesSource.monthProduct !== undefined && seriesSource.monthProduct !== null) {
    series.monthProduct = sanitizeMonthlyAggregateMap(seriesSource.monthProduct, 'views.b2c.series.monthProduct');
  }
  result.series = series;
  return result;
}

function sanitizeB2BSummary(value, context) {
  const source = object(value, context);
  const result = {};
  pickRequired(result, source, 'count', optionalInteger, context);
  pickRequired(result, source, 'licenses', optionalInteger, context);
  pickRequired(result, source, 'sumMonthlyMinorUnits', optionalIntegerText, context);
  if (source.currency !== undefined) result.currency = optionalText(source.currency, `${context}.currency`, { max: 16 });
  return result;
}

function sanitizeB2BSummaryMap(value, context) {
  if (value === undefined || value === null) return {};
  return Object.fromEntries(sortedEntries(value, context).map(([key, entry]) => [
    dimensionKey(key, `${context}.${key}`),
    sanitizeB2BSummary(entry, `${context}.${key}`),
  ]));
}

function sanitizeB2B(value) {
  const source = object(value, 'views.b2b');
  const result = {};
  pickRequired(result, source, 'count', optionalInteger, 'views.b2b');
  if (source.currency !== undefined) result.currency = optionalText(source.currency, 'views.b2b.currency', { max: 16 });
  result.byStatus = sanitizeB2BSummaryMap(source.byStatus, 'views.b2b.byStatus');
  result.byPlan = sanitizeB2BSummaryMap(source.byPlan, 'views.b2b.byPlan');
  result.byRegion = sanitizeB2BSummaryMap(source.byRegion, 'views.b2b.byRegion');
  result.sourceAsOf = optionalText(source.sourceAsOf, 'views.b2b.sourceAsOf', { max: 80 });
  result.referenceDate = optionalText(source.referenceDate, 'views.b2b.referenceDate', { max: 80 });
  return result;
}

function sanitizeMonthlyRecord(value, context) {
  const source = object(value, context);
  const result = {};
  pickRequired(result, source, 'month', (entry, fieldContext) => dimensionKey(entry, fieldContext, { month: true }), context);
  if (source.currency !== undefined) result.currency = optionalText(source.currency, `${context}.currency`, { max: 16 });
  for (const key of ['b2cSignedCents', 'b2cPositiveCents', 'b2bSumMonthlyMinorUnits', 'combinedAssumedBrlCents']) {
    pickRequired(result, source, key, optionalIntegerText, context);
  }
  pickRequired(result, source, 'b2bContractCount', optionalInteger, context);
  if (source.b2bCurrencyObserved !== undefined) {
    result.b2bCurrencyObserved = optionalText(source.b2bCurrencyObserved, `${context}.b2bCurrencyObserved`, { max: 16 });
  }
  const b2cSigned = BigInt(result.b2cSignedCents);
  const b2bMonthly = BigInt(result.b2bSumMonthlyMinorUnits);
  const combined = BigInt(result.combinedAssumedBrlCents);
  if (b2cSigned + b2bMonthly !== combined || b2bMonthly < 0n) {
    throw codeError('DASHBOARD_BUNDLE_INVALID', `${context} arithmetic is inconsistent`);
  }
  // Deliberately omit b2bContractIds: aggregate count is safe, row identifiers are not.
  return result;
}

function sanitizeMonthlyComposition(value) {
  if (value === undefined || value === null) return null;
  const source = object(value, 'views.total.monthlyComposition');
  const result = {};
  for (const key of ['scenarioId', 'b2bCurrencyAssumption', 'statusFilter', 'statusFilterMeaning', 'coexistence']) {
    result[key] = safeText(source[key], `views.total.monthlyComposition.${key}`, { max: 160, nullable: false });
  }
  result.currency = safeText(source.currency, 'views.total.monthlyComposition.currency', { max: 16, nullable: false });
  pickRequired(result, source, 'fullMonthFromStart', optionalBoolean, 'views.total.monthlyComposition');
  if (!Array.isArray(source.months) || !Array.isArray(source.records)) {
    throw codeError('DASHBOARD_BUNDLE_INVALID', 'views.total.monthlyComposition months and records are required');
  }
  result.months = source.months.map((month, index) => dimensionKey(month, `views.total.monthlyComposition.months[${index}]`, { month: true }));
  result.records = source.records.map((record, index) => sanitizeMonthlyRecord(record, `views.total.monthlyComposition.records[${index}]`));
  if (result.months.length !== result.records.length
    || result.records.some((record, index) => record.month !== result.months[index])) {
    throw codeError('DASHBOARD_BUNDLE_INVALID', 'views.total.monthlyComposition months and records differ');
  }
  return result;
}

function sanitizeTotal(value) {
  const source = object(value, 'views.total');
  const result = {};
  if (source.official !== undefined) result.official = optionalIntegerText(source.official, 'views.total.official');
  if (source.officialReason !== undefined) result.officialReason = safeText(source.officialReason, 'views.total.officialReason', { max: 1024 });
  result.window = sanitizeWindow(source.window, 'views.total.window');
  const observed = optionalObject(source.observedComponents, 'views.total.observedComponents');
  if (observed) {
    const observedResult = {};
    const b2c = optionalObject(observed.b2c, 'views.total.observedComponents.b2c');
    const b2b = optionalObject(observed.b2b, 'views.total.observedComponents.b2b');
    if (b2c) {
      observedResult.b2c = {};
      pickOptional(observedResult.b2c, b2c, 'signedCents', optionalIntegerText);
      if (b2c.currency !== undefined) observedResult.b2c.currency = optionalText(b2c.currency, 'views.total.observedComponents.b2c.currency', { max: 16 });
    }
    if (b2b) {
      observedResult.b2b = {};
      pickOptional(observedResult.b2b, b2b, 'sumMonthlyMinorUnits', optionalIntegerText);
      pickOptional(observedResult.b2b, b2b, 'count', optionalInteger);
      pickOptional(observedResult.b2b, b2b, 'licenses', optionalInteger);
      if (b2b.currency !== undefined) observedResult.b2b.currency = optionalText(b2b.currency, 'views.total.observedComponents.b2b.currency', { max: 16 });
    }
    result.observedComponents = observedResult;
  }
  result.monthlyComposition = sanitizeMonthlyComposition(source.monthlyComposition);
  return result;
}

function pairValue(source, key, context, { timestamp = false } = {}) {
  const sourceObject = optionalObject(source, context) ?? {};
  const result = {};
  for (const name of ['b2c', 'b2b']) {
    result[name] = timestamp
      ? optionalTimestamp(sourceObject[name], `${context}.${name}`)
      : optionalText(sourceObject[name], `${context}.${name}`, { max: 160 });
  }
  return result;
}

function sanitizeMetadata(value, versionId) {
  const source = object(value, 'views.metadata');
  const metadataVersion = source.versionId === undefined || source.versionId === null
    ? versionId
    : requiredUuid(source.versionId, 'views.metadata.versionId');
  if (metadataVersion !== versionId) throw codeError('DASHBOARD_VERSION_MISMATCH', 'views metadata version differs from selected version');
  const result = {
    versionId,
    calculatedAt: optionalTimestamp(source.calculatedAt, 'views.metadata.calculatedAt'),
    transformationVersion: optionalText(source.transformationVersion, 'views.metadata.transformationVersion', { max: 80 }),
    capturedAt: pairValue(source.capturedAt, 'views.metadata.capturedAt', 'views.metadata.capturedAt', { timestamp: true }),
    captureMeaning: pairValue(source.captureMeaning, 'views.metadata.captureMeaning', 'views.metadata.captureMeaning'),
    sourceAsOf: pairValue(source.sourceAsOf, 'views.metadata.sourceAsOf', 'views.metadata.sourceAsOf'),
    referenceDate: pairValue(source.referenceDate, 'views.metadata.referenceDate', 'views.metadata.referenceDate'),
    assumptions: Array.isArray(source.assumptions)
      ? source.assumptions.filter((entry) => typeof entry === 'string' && SAFE_TEXT_RE.test(entry)).slice(0, 32)
      : [],
    limitations: Array.isArray(source.limitations)
      ? source.limitations.filter((entry) => typeof entry === 'string' && SAFE_TEXT_RE.test(entry)).slice(0, 32)
      : [],
  };
  return result;
}

function sanitizeViews(value, versionId) {
  const source = object(value, 'views');
  return {
    metadata: sanitizeMetadata(source.metadata, versionId),
    b2c: sanitizeB2C(source.b2c),
    b2b: sanitizeB2B(source.b2b),
    total: sanitizeTotal(source.total),
  };
}

function warningSummary(quality, context) {
  const source = optionalObject(quality, context) ?? {};
  const warningList = Array.isArray(source.warnings) ? source.warnings : [];
  const declaredWarningCount = source.warning_count ?? source.warningCount;
  if (declaredWarningCount !== undefined && declaredWarningCount !== null
    && (!Number.isSafeInteger(declaredWarningCount) || declaredWarningCount < 0
      || declaredWarningCount !== warningList.length)) {
    throw codeError('DASHBOARD_BUNDLE_INVALID', `${context}.warningCount does not match warnings`);
  }
  const counts = new Map();
  let unclassifiedWarningCount = 0;
  for (const warning of warningList) {
    if (warning && typeof warning.code === 'string' && WARNING_CODES.has(warning.code)) {
      counts.set(warning.code, (counts.get(warning.code) ?? 0) + 1);
    } else {
      // Unknown/private warning identifiers contribute to the safe total but
      // are never copied to the browser, even under a generic label.
      unclassifiedWarningCount += 1;
    }
  }
  const warningCount = declaredWarningCount ?? warningList.length;
  const result = {
    rowCount: optionalInteger(source.row_count ?? source.rowCount, `${context}.rowCount`) ?? 0,
    warningCount: optionalInteger(warningCount, `${context}.warningCount`) ?? 0,
    warningCodes: [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([code, count]) => ({ code, count })),
    unclassifiedWarningCount,
    replacementCharacterCount: optionalInteger(source.replacement_character_count ?? source.replacementCharacterCount, `${context}.replacementCharacterCount`) ?? 0,
  };
  if (source.counts !== undefined && source.counts !== null) {
    const countsObject = object(source.counts, `${context}.counts`);
    result.counts = {};
    for (const key of ['positive', 'negative', 'zero']) {
      if (countsObject[key] !== undefined) result.counts[key] = optionalInteger(countsObject[key], `${context}.counts.${key}`);
    }
  }
  return result;
}

function sanitizeManifest(value, versionId, metadata) {
  const source = object(value, 'manifest');
  const manifestVersion = requiredUuid(source.versionId, 'manifest.versionId');
  if (manifestVersion !== versionId) throw codeError('DASHBOARD_VERSION_MISMATCH', 'manifest version differs from selected version');
  if (source.sourceCredentialRightsVerified === true) {
    throw codeError('DASHBOARD_BUNDLE_INVALID', 'external credential rights cannot be asserted by local dashboard');
  }
  const sources = Array.isArray(source.sources) ? source.sources : [];
  if (sources.length !== LOCAL_SOURCE_IDS.size) {
    throw codeError('DASHBOARD_BUNDLE_INVALID', 'manifest.sources must contain both frozen sources');
  }
  const seenSourceIds = new Set();
  const sanitizedSources = sources.map((entry, index) => {
    const item = object(entry, `manifest.sources[${index}]`);
    const sourceId = safeText(item.sourceId, `manifest.sources[${index}].sourceId`, { max: 32, nullable: false });
    if (!LOCAL_SOURCE_IDS.has(sourceId)) throw codeError('DASHBOARD_BUNDLE_INVALID', `unsupported source ${sourceId}`);
    if (seenSourceIds.has(sourceId)) throw codeError('DASHBOARD_BUNDLE_INVALID', `duplicate source ${sourceId}`);
    seenSourceIds.add(sourceId);
    if (typeof item.sha256 !== 'string' || !SHA256_RE.test(item.sha256)) throw codeError('DASHBOARD_BUNDLE_INVALID', `manifest.sources[${index}].sha256 is invalid`);
    const bytes = optionalInteger(item.bytes, `manifest.sources[${index}].bytes`);
    if (bytes === undefined) throw codeError('DASHBOARD_BUNDLE_INVALID', `manifest.sources[${index}].bytes is required`);
    if (item.mode !== LOCAL_SOURCE_MODE) throw codeError('DASHBOARD_BUNDLE_INVALID', `manifest.sources[${index}].mode is invalid`);
    const localReadAt = optionalTimestamp(item.localReadAt, `manifest.sources[${index}].localReadAt`, { required: true });
    const sourceAsOf = item.sourceAsOf === undefined || item.sourceAsOf === null
      ? null
      : safeText(item.sourceAsOf, `manifest.sources[${index}].sourceAsOf`, { max: 80 });
    const sourceName = sourceId === 'b2c-csv' ? 'b2c' : 'b2b';
    return {
      sourceId,
      sha256: item.sha256,
      localReadAt,
      sourceAsOf,
      mode: LOCAL_SOURCE_MODE,
      captureMeaning: metadata.captureMeaning[sourceName],
    };
  }).sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  if (seenSourceIds.size !== LOCAL_SOURCE_IDS.size) throw codeError('DASHBOARD_BUNDLE_INVALID', 'manifest.sources is incomplete');
  return {
    publishedAt: optionalTimestamp(source.publishedAt, 'manifest.publishedAt', { required: true }),
    capturedAt: optionalTimestamp(source.capturedAt, 'manifest.capturedAt', { required: true }),
    executionMode: EXECUTION_MODES.has(source.executionMode) ? source.executionMode : (() => {
      throw codeError('DASHBOARD_BUNDLE_INVALID', 'manifest.executionMode is unsupported');
    })(),
    viewFormulaVersion: safeText(source.viewFormulaVersion, 'manifest.viewFormulaVersion', { max: 80, nullable: false }),
    transformationVersion: safeText(source.transformationVersion, 'manifest.transformationVersion', { max: 80, nullable: false }),
    sourceCredentialRightsVerified: source.sourceCredentialRightsVerified === false ? false : null,
    sources: sanitizedSources,
  };
}

export function sanitizeAttempt(value) {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const status = typeof value.status === 'string' && ATTEMPT_STATUSES.has(value.status) ? value.status : null;
  const candidateRunId = value.runId ?? value.clientRunId;
  const runId = typeof candidateRunId === 'string' && SAFE_ID_RE.test(candidateRunId) ? candidateRunId : null;
  const errorCode = typeof value.errorCode === 'string' && ERROR_CODE_RE.test(value.errorCode) ? value.errorCode : null;
  const startedAt = typeof value.startedAt === 'string' && ISO_TIMESTAMP_RE.test(value.startedAt) ? value.startedAt : null;
  const endedAtCandidate = value.endedAt ?? value.finishedAt ?? value.failedAt;
  const endedAt = typeof endedAtCandidate === 'string' && ISO_TIMESTAMP_RE.test(endedAtCandidate) ? endedAtCandidate : null;
  if (status === null && runId === null && errorCode === null && startedAt === null && endedAt === null) return null;
  return { status, runId, errorCode, startedAt, endedAt };
}


function selectedVersionId(bundle) {
  const value = bundle?.version_id ?? bundle?.versionId;
  return requiredUuid(value, 'bundle.version_id');
}

/**
 * Convert one published bundle into the local dashboard contract. Every
 * nested object is rebuilt from an explicit allowlist; the source bundle is
 * never returned or spread into the DTO.
 */
export function toDashboardDTO(bundle, attempt = null) {
  const source = object(bundle, 'bundle');
  const versionId = selectedVersionId(source);
  const metadata = object(source.views, 'views').metadata;
  const sanitizedMetadata = sanitizeMetadata(metadata, versionId);
  const dto = {
    versionId,
    manifest: sanitizeManifest(source.manifest, versionId, sanitizedMetadata),
    views: sanitizeViews(source.views, versionId),
    quality: {
      b2c: warningSummary(source.manifest?.quality?.b2c, 'quality.b2c'),
      b2b: warningSummary(source.manifest?.quality?.b2b, 'quality.b2b'),
    },
    attempt: sanitizeAttempt(attempt),
  };
  return dto;
}
