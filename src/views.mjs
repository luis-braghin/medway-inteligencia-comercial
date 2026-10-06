const B2C_CURRENCY = "BRL";
const B2B_OBSERVED_CURRENCY = null;
export const VIEW_FORMULA_VERSION = "medway-views-v2";
const TRANSFORMATION_VERSION = VIEW_FORMULA_VERSION;
const MAX_WINDOW_MONTHS = 240;
const MIN_YEAR = 1;
const MAX_YEAR = 9999;

function recordsOf(value, name) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.records)) return value.records;
  throw new TypeError(name + " must be an array or an object with records");
}

function integerBigInt(value, field) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError(field + " must be a safe integer");
    return BigInt(value);
  }
  if (typeof value === "string" && /^[+-]?\d+$/u.test(value.trim())) {
    return BigInt(value.trim());
  }
  throw new TypeError(field + " must be an integer");
}

function nonNegativeCount(value, field) {
  const result = integerBigInt(value, field);
  if (result < 0n || result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError(field + " must be a non-negative safe integer");
  }
  return Number(result);
}

function safeNumberFromBigInt(value, field) {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError(field + " aggregate must be a safe integer");
  }
  return Number(value);
}

function amountOfB2C(row) {
  return integerBigInt(row.amount_cents ?? row.amountCents, "amount_cents");
}

function amountOfB2B(row) {
  return integerBigInt(
    row.monthly_minor_units ?? row.monthlyMinorUnits,
    "monthly_minor_units",
  );
}

function parseYearMonth(value, field) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}$/u.test(value)) {
    throw new TypeError(field + " must use YYYY-MM");
  }
  const [year, month] = value.split("-").map(Number);
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12) {
    throw new TypeError(field + " has an invalid year or month");
  }
  return value;
}

function daysInMonth(year, month) {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function monthFromDate(value, field) {
  if (typeof value !== "string") throw new TypeError(field + " must use ISO date YYYY-MM-DD");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) throw new TypeError(field + " must use ISO date YYYY-MM-DD");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    year < MIN_YEAR
    || year > MAX_YEAR
    || month < 1
    || month > 12
    || day < 1
    || day > daysInMonth(year, month)
  ) {
    throw new TypeError(field + " has an invalid ISO date");
  }
  return String(year).padStart(4, "0") + "-" + String(month).padStart(2, "0");
}

function monthOfB2C(row) {
  const explicit = row.month ?? row.month_id ?? row.monthId;
  if (explicit !== undefined && explicit !== null) {
    return parseYearMonth(explicit, "B2C month");
  }
  return monthFromDate(row.date ?? row.data_venda, "B2C date");
}

function monthOfB2BStart(row) {
  const startDate = row.start_date ?? row.startDate;
  if (startDate === undefined || startDate === null) return null;
  return monthFromDate(startDate, "B2B start_date");
}

function assertMonth(month, field) {
  return month === null ? null : parseYearMonth(month, field);
}

function nextMonth(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const next = monthNumber === 12
    ? { year: year + 1, month: 1 }
    : { year, month: monthNumber + 1 };
  return String(next.year).padStart(4, "0") + "-" + String(next.month).padStart(2, "0");
}

function monthRange(minMonth, maxMonth) {
  if (!minMonth || !maxMonth) return [];
  const months = [];
  let current = minMonth;
  while (current <= maxMonth) {
    if (months.length >= MAX_WINDOW_MONTHS) {
      throw new RangeError("B2C month window exceeds " + MAX_WINDOW_MONTHS + " months");
    }
    months.push(current);
    current = nextMonth(current);
  }
  return months;
}

function dimensionLabel(value) {
  if (value === undefined || value === null || value === "") return "__missing__";
  return String(value);
}

function createAccumulator() {
  return {
    count: 0,
    positiveCount: 0,
    negativeCount: 0,
    zeroCount: 0,
    signed: 0n,
    positive: 0n,
    negative: 0n,
  };
}

function addAmount(accumulator, amount) {
  accumulator.count += 1;
  accumulator.signed += amount;
  if (amount > 0n) {
    accumulator.positiveCount += 1;
    accumulator.positive += amount;
  } else if (amount < 0n) {
    accumulator.negativeCount += 1;
    accumulator.negative += amount;
  } else {
    accumulator.zeroCount += 1;
  }
}

function ticketFor(accumulator) {
  const denominator = accumulator.positiveCount;
  return {
    universe: "positive_amounts",
    numeratorCents: accumulator.positive.toString(),
    denominator,
    denominatorCount: denominator,
    exactRatio: denominator === 0
      ? null
      : {
          numeratorCents: accumulator.positive.toString(),
          denominator,
        },
  };
}

function serializeAccumulator(accumulator) {
  return {
    count: accumulator.count,
    positiveCount: accumulator.positiveCount,
    negativeCount: accumulator.negativeCount,
    zeroCount: accumulator.zeroCount,
    signedCents: accumulator.signed.toString(),
    positiveCents: accumulator.positive.toString(),
    negativeCents: accumulator.negative.toString(),
    zeroCents: "0",
    ticket: ticketFor(accumulator),
  };
}

function aggregateRows(rows, amountReader) {
  const accumulator = createAccumulator();
  for (const row of rows) addAmount(accumulator, amountReader(row));
  return accumulator;
}

function sortedObject(entries) {
  return Object.fromEntries(
    [...entries].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function buildDimensionSeries(rows, dimension, amountReader) {
  const groups = new Map();
  for (const row of rows) {
    const rawValue = dimension === "month"
      ? monthOfB2C(row)
      : row[dimension] ?? row[dimension.replace(/^./u, (letter) => letter.toUpperCase())];
    const key = dimensionLabel(rawValue);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return sortedObject(
    [...groups.entries()].map(([key, group]) => [
      key,
      serializeAccumulator(aggregateRows(group, amountReader)),
    ]),
  );
}

function buildMonthSeries(rows, months, amountReader) {
  const groups = new Map(months.map((month) => [month, []]));
  for (const row of rows) {
    const month = assertMonth(monthOfB2C(row), "B2C month");
    if (month === null) throw new TypeError("B2C record requires date or month");
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(row);
  }
  return Object.fromEntries(
    [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([month, group]) => [
        month,
        serializeAccumulator(aggregateRows(group, amountReader)),
      ]),
  );
}

function buildMonthlyDimension(rows, months, dimension, amountReader) {
  const grouped = new Map(months.map(month => [month, []]));
  for (const row of rows) grouped.get(monthOfB2C(row)).push(row);
  return Object.fromEntries(months.map(month => [month, buildDimensionSeries(grouped.get(month), dimension, amountReader)]));
}

function sourceField(sources, sourceName, ...fieldNames) {
  const source = sourceEntry(sources, sourceName);
  if (!source || typeof source !== "object") return null;
  for (const fieldName of fieldNames) {
    if (source[fieldName] !== undefined) return source[fieldName];
  }
  return null;
}

function sourceEntry(sources, sourceName) {
  if (Array.isArray(sources)) {
    const sourceId = sourceName === "b2c" ? "b2c-csv" : "b2b-json";
    return sources.find((source) => source && source.sourceId === sourceId) ?? null;
  }
  return sources && typeof sources === "object" ? sources[sourceName] : null;
}

function capturedAtForSource(sources, sourceName) {
  const source = sourceEntry(sources, sourceName);
  if (!source || typeof source !== "object") return { value: null, meaning: null };
  for (const fieldName of ["capturedAt", "captured_at"]) {
    if (source[fieldName] !== undefined) {
      return {
        value: source[fieldName],
        meaning: source.captureMeaning ?? source.capture_meaning ?? null,
      };
    }
  }
  if (source.localReadAt !== undefined) {
    return {
      value: source.localReadAt,
      meaning: "local_import_of_frozen_snapshot",
    };
  }
  return { value: null, meaning: source.captureMeaning ?? source.capture_meaning ?? null };
}

function sourceMetadata(sources) {
  const b2cCaptured = capturedAtForSource(sources, "b2c");
  const b2bCaptured = capturedAtForSource(sources, "b2b");
  return {
    capturedAt: {
      b2c: b2cCaptured.value,
      b2b: b2bCaptured.value,
    },
    captureMeaning: {
      b2c: b2cCaptured.meaning,
      b2b: b2bCaptured.meaning,
    },
    sourceAsOf: {
      b2c: sourceField(sources, "b2c", "sourceAsOf", "source_as_of", "asOf", "as_of"),
      b2b: sourceField(sources, "b2b", "sourceAsOf", "source_as_of", "asOf", "as_of"),
    },
    referenceDate: {
      b2c: sourceField(sources, "b2c", "referenceDate", "reference_date"),
      b2b: sourceField(sources, "b2b", "referenceDate", "reference_date"),
    },
  };
}

function b2bStatusKey(status) {
  return status === undefined || status === null || status === ""
    ? "__missing__"
    : String(status);
}

function buildB2BSummary(rows, dimension = "status") {
  const statuses = new Map();
  for (const row of rows) {
    const key = b2bStatusKey(row[dimension]);
    if (!statuses.has(key)) {
      statuses.set(key, {
        count: 0,
        licenses: 0n,
        sum: 0n,
      });
    }
    const group = statuses.get(key);
    group.count += 1;
    group.licenses += BigInt(nonNegativeCount(row.licenses, "licenses"));
    group.sum += amountOfB2B(row);
  }
  return sortedObject(
    [...statuses.entries()].map(([status, group]) => [
      status,
      {
        count: group.count,
        licenses: safeNumberFromBigInt(group.licenses, "licenses"),
        sumMonthlyMinorUnits: group.sum.toString(),
        currency: B2B_OBSERVED_CURRENCY,
      },
    ]),
  );
}

function b2bActiveContractsByMonth(rows, months) {
  const result = [];
  const activeRows = rows.filter((row) => String(row.status) === "ativo");
  for (const month of months) {
    const eligible = activeRows.filter((row) => {
      const startMonth = assertMonth(monthOfB2BStart(row), "B2B start_date");
      if (startMonth === null) throw new TypeError("B2B active record requires start_date");
      return startMonth <= month;
    });
    let sum = 0n;
    for (const row of eligible) sum += amountOfB2B(row);
    result.push({
      month,
      contractIds: eligible
        .map((row) => String(row.contract_id ?? row.contractId))
        .sort((left, right) => left.localeCompare(right)),
      contractCount: eligible.length,
      sumMonthlyMinorUnits: sum.toString(),
    });
  }
  return result;
}

function observedB2BTotals(rows) {
  let licenses = 0n;
  let sum = 0n;
  for (const row of rows) {
    licenses += BigInt(nonNegativeCount(row.licenses, "licenses"));
    sum += amountOfB2B(row);
  }
  return {
    count: rows.length,
    licenses: safeNumberFromBigInt(licenses, "licenses"),
    sumMonthlyMinorUnits: sum.toString(),
  };
}

function monthlyComposition(b2cSeries, b2bRows, months) {
  const b2bByMonth = b2bActiveContractsByMonth(b2bRows, months);
  const records = months.map((month, index) => {
    const b2c = b2cSeries[month];
    const b2b = b2bByMonth[index];
    const b2cSigned = BigInt(b2c.signedCents);
    const b2bMonthly = BigInt(b2b.sumMonthlyMinorUnits);
    return {
      month,
      currency: B2C_CURRENCY,
      b2cSignedCents: b2c.signedCents,
      b2cPositiveCents: b2c.positiveCents,
      b2bSumMonthlyMinorUnits: b2b.sumMonthlyMinorUnits,
      b2bCurrencyObserved: B2B_OBSERVED_CURRENCY,
      b2bContractIds: b2b.contractIds,
      b2bContractCount: b2b.contractCount,
      combinedAssumedBrlCents: (b2cSigned + b2bMonthly).toString(),
    };
  });
  return {
    scenarioId: "monthly_composition_brl_assumed_coexistence",
    currency: B2C_CURRENCY,
    b2bCurrencyAssumption: B2C_CURRENCY,
    statusFilter: "ativo",
    statusFilterMeaning: "current_snapshot_status_hypothesis_not_history",
    coexistence: "all_eligible_active_contract_ids_are_kept",
    fullMonthFromStart: true,
    months,
    records,
  };
}

export function buildViews({ b2c, b2b, versionId, sources, calculatedAt }) {
  const b2cRows = recordsOf(b2c, "b2c");
  const b2bRows = recordsOf(b2b, "b2b");
  const b2cAmount = (row) => amountOfB2C(row);
  const b2cMonths = b2cRows
    .map(monthOfB2C)
    .map((month) => assertMonth(month, "B2C month"))
    .filter((month) => month !== null)
    .sort();
  if (b2cRows.length > 0 && b2cMonths.length !== b2cRows.length) {
    throw new TypeError("B2C records require date or month");
  }
  const minMonth = b2cMonths[0] ?? null;
  const maxMonth = b2cMonths.at(-1) ?? null;
  const months = monthRange(minMonth, maxMonth);
  const metadataSources = sourceMetadata(sources);
  const b2cSeries = buildMonthSeries(b2cRows, months, b2cAmount);
  const b2cSummary = serializeAccumulator(aggregateRows(b2cRows, b2cAmount));
  const b2bObservedTotals = observedB2BTotals(b2bRows);
  const composition = monthlyComposition(b2cSeries, b2bRows, months);

  return {
    metadata: {
      versionId: versionId ?? null,
      calculatedAt: calculatedAt ?? null,
      transformationVersion: TRANSFORMATION_VERSION,
      sources: sources ?? null,
      capturedAt: metadataSources.capturedAt,
      captureMeaning: metadataSources.captureMeaning,
      sourceAsOf: metadataSources.sourceAsOf,
      referenceDate: metadataSources.referenceDate,
      assumptions: [
        "B2C monetary values are observed in BRL cents.",
        "B2B observed currency is null; monthly composition assumes BRL only as an explicit scenario.",
        "B2B source_as_of is absent unless supplied in sources; capturedAt and referenceDate remain separate fields.",
        "The monthly scenario keeps all eligible IDs whose current snapshot status is ativo; this is not status history or substitution.",
        "A contract starting during a month contributes a full month from that month onward.",
        "The official financial total is unavailable.",
        "The B2C window is inclusive and limited to 240 months.",
      ],
      limitations: [
        "The views do not infer historical status, payment, recognition, predecessor or customer identity.",
        "The B2B monthly sum is an observed snapshot aggregation and is not realized revenue.",
      ],
    },
    b2c: {
      currency: B2C_CURRENCY,
      ...b2cSummary,
      series: {
        month: b2cSeries,
        channel: buildDimensionSeries(b2cRows, "channel", b2cAmount),
        product: buildDimensionSeries(b2cRows, "product", b2cAmount),
        monthChannel: buildMonthlyDimension(b2cRows, months, "channel", b2cAmount),
        monthProduct: buildMonthlyDimension(b2cRows, months, "product", b2cAmount),
      },
      window: {
        minMonth,
        maxMonth,
        monthsB2C: months.length,
      },
    },
    b2b: {
      count: b2bRows.length,
      currency: B2B_OBSERVED_CURRENCY,
      byStatus: buildB2BSummary(b2bRows),
      byPlan: buildB2BSummary(b2bRows, "plan"),
      byRegion: buildB2BSummary(b2bRows, "region"),
      sourceAsOf: metadataSources.sourceAsOf.b2b,
      referenceDate: metadataSources.referenceDate.b2b,
    },
    total: {
      official: null,
      officialReason:
        "Total financeiro oficial indisponível: B2C é fluxo BRL observado e B2B é snapshot sem moeda, referência temporal e semântica financeira compatível.",
      window: {
        minMonth,
        maxMonth,
        monthsB2C: months.length,
      },
      observedComponents: {
        b2c: {
          signedCents: b2cSummary.signedCents,
          currency: B2C_CURRENCY,
        },
        b2b: {
          sumMonthlyMinorUnits: b2bObservedTotals.sumMonthlyMinorUnits,
          currency: B2B_OBSERVED_CURRENCY,
          count: b2bObservedTotals.count,
          licenses: b2bObservedTotals.licenses,
        },
      },
      monthlyComposition: composition,
    },
  };
}
