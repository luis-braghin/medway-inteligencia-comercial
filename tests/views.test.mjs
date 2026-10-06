import assert from "node:assert/strict";
import test from "node:test";

import { buildViews } from "../src/views.mjs";

const b2cFixture = [
  {
    record_key: "b2c-1",
    date: "2025-01-10",
    month: "2025-01",
    channel: "Orgânico",
    product: "Curso A",
    amount_cents: 101,
  },
  {
    record_key: "b2c-2",
    date: "2025-03-10",
    month: "2025-03",
    channel: "Orgânico",
    product: "Curso A",
    amount_cents: 100,
  },
  {
    record_key: "b2c-3",
    date: "2025-03-11",
    month: "2025-03",
    channel: "Evento",
    product: "Curso B",
    amount_cents: -40,
  },
  {
    record_key: "b2c-4",
    date: "2025-07-01",
    month: "2025-07",
    channel: "Evento",
    product: "Curso B",
    amount_cents: 50,
  },
  {
    record_key: "b2c-5",
    date: "2026-07-01",
    month: "2026-07",
    channel: "Orgânico",
    product: "Curso A",
    amount_cents: 0,
  },
];

const b2bFixture = [
  {
    contract_id: "C-1",
    institution: "Instituição 1",
    licenses: 1,
    monthly_minor_units: 7,
    start_date: "2025-01-20",
    status: "ativo",
  },
  {
    contract_id: "C-2",
    institution: "Instituição 2",
    licenses: 2,
    monthly_minor_units: 5,
    start_date: "2025-03-01",
    status: "ativo",
  },
  {
    contract_id: "C-3",
    institution: "Instituição 3",
    licenses: 4,
    monthly_minor_units: 9,
    start_date: "2025-01-01",
    status: "pausado",
  },
  {
    contract_id: "C-4",
    institution: "Instituição 4",
    licenses: 3,
    monthly_minor_units: 11,
    start_date: "2026-07-31",
    status: "ativo",
  },
];

test("buildViews preserves signed cents, separates zero/negative and creates exact positive ticket", () => {
  const views = buildViews({
    b2c: { records: b2cFixture },
    b2b: { records: b2bFixture },
    versionId: "run-001",
    calculatedAt: "2026-10-05T12:00:00Z",
    sources: {
      b2c: { capturedAt: "2026-10-05T11:00:00Z", referenceDate: "2026-10-05" },
      b2b: { capturedAt: "2026-10-05T11:05:00Z", referenceDate: "2026-10-04" },
    },
  });

  assert.deepEqual(views.b2c.count, 5);
  assert.equal(views.b2c.signedCents, "211");
  assert.equal(views.b2c.positiveCents, "251");
  assert.equal(views.b2c.negativeCents, "-40");
  assert.equal(views.b2c.zeroCents, "0");
  assert.deepEqual(
    {
      positive: views.b2c.positiveCount,
      negative: views.b2c.negativeCount,
      zero: views.b2c.zeroCount,
    },
    { positive: 3, negative: 1, zero: 1 },
  );
  assert.deepEqual(views.b2c.ticket, {
    universe: "positive_amounts",
    numeratorCents: "251",
    denominator: 3,
    denominatorCount: 3,
    exactRatio: { numeratorCents: "251", denominator: 3 },
  });
  assert.equal(views.b2c.currency, "BRL");

  assert.equal(views.b2c.series.month["2025-02"].count, 0);
  assert.equal(views.b2c.series.month["2025-02"].signedCents, "0");
  assert.equal(views.b2c.series.channel["Orgânico"].positiveCents, "201");
  assert.equal(views.b2c.series.product["Curso B"].negativeCents, "-40");
  assert.equal(views.b2c.window.minMonth, "2025-01");
  assert.equal(views.b2c.window.maxMonth, "2026-07");
  assert.equal(views.b2c.window.monthsB2C, 19);
  assert.equal(views.b2c.series.monthChannel['2025-03']['Evento'].signedCents, '-40');
  assert.equal(views.b2c.series.monthProduct['2025-03']['Curso A'].positiveCents, '100');
  assert.deepEqual(views.b2c.series.monthChannel['2025-02'], {});
  assert.equal(views.metadata.transformationVersion, 'medway-views-v2');
});

test("buildViews reports B2B observed status totals without a currency or realized-revenue label", () => {
  const views = buildViews({
    b2c: b2cFixture,
    b2b: b2bFixture,
    versionId: "run-002",
    sources: {
      b2c: { capturedAt: "2026-10-05T11:00:00Z", sourceAsOf: null },
      b2b: { capturedAt: "2026-10-05T11:05:00Z" },
    },
  });

  assert.equal(views.b2b.count, 4);
  assert.equal(views.b2b.currency, null);
  assert.deepEqual(views.b2b.byStatus.ativo, {
    count: 3,
    licenses: 6,
    sumMonthlyMinorUnits: "23",
    currency: null,
  });
  assert.deepEqual(views.b2b.byStatus.pausado, {
    count: 1,
    licenses: 4,
    sumMonthlyMinorUnits: "9",
    currency: null,
  });
  assert.equal("mrrRealized" in views.b2b, false);
  assert.equal("historical" in views.b2b, false);
  assert.equal(views.metadata.sourceAsOf.b2b, null);
  assert.equal(views.metadata.capturedAt.b2b, "2026-10-05T11:05:00Z");
  assert.equal(views.metadata.referenceDate.b2b, null);
});

test("monthly composition is an explicit BRL assumption with coexistence and current-status filtering", () => {
  const views = buildViews({
    b2c: b2cFixture,
    b2b: b2bFixture,
    versionId: "run-003",
    calculatedAt: "2026-10-05T12:00:00Z",
  });

  assert.equal(views.total.official, null);
  assert.match(views.total.officialReason, /oficial indisponível/u);

  const scenario = views.total.monthlyComposition;
  assert.equal(scenario.currency, "BRL");
  assert.equal(scenario.b2bCurrencyAssumption, "BRL");
  assert.equal(scenario.statusFilter, "ativo");
  assert.equal(scenario.statusFilterMeaning, "current_snapshot_status_hypothesis_not_history");
  assert.equal(scenario.coexistence, "all_eligible_active_contract_ids_are_kept");
  assert.equal(scenario.fullMonthFromStart, true);
  assert.equal(scenario.records.length, 19);

  assert.deepEqual(scenario.records[0], {
    month: "2025-01",
    currency: "BRL",
    b2cSignedCents: "101",
    b2cPositiveCents: "101",
    b2bSumMonthlyMinorUnits: "7",
    b2bCurrencyObserved: null,
    b2bContractIds: ["C-1"],
    b2bContractCount: 1,
    combinedAssumedBrlCents: "108",
  });
  assert.deepEqual(scenario.records[1].b2bContractIds, ["C-1"]);
  assert.equal(scenario.records[2].b2bSumMonthlyMinorUnits, "12");
  assert.deepEqual(scenario.records.at(-1).b2bContractIds, ["C-1", "C-2", "C-4"]);
  assert.equal(scenario.records.at(-1).combinedAssumedBrlCents, "23");
  assert.equal(views.total.window.monthsB2C, 19);
});

test("ticket has no misleading rounded cent value when there are no positive records", () => {
  const views = buildViews({
    b2c: [
      {
        date: "2025-01-01",
        channel: "A",
        product: "P",
        amount_cents: -1,
      },
      {
        date: "2025-01-02",
        channel: "A",
        product: "P",
        amount_cents: 0,
      },
    ],
    b2b: [],
  });

  assert.equal(views.b2c.signedCents, "-1");
  assert.equal(views.b2c.positiveCents, "0");
  assert.equal(views.b2c.negativeCents, "-1");
  assert.equal(views.b2c.ticket.universe, "positive_amounts");
  assert.equal(views.b2c.ticket.denominator, 0);
  assert.equal(views.b2c.ticket.exactRatio, null);
  assert.equal(views.total.monthlyComposition.records.length, 1);
});

test("source metadata arrays use localReadAt as capture time without fabricating source freshness", () => {
  const sources = [
    {
      sourceId: "b2c-csv",
      sha256: "b2c-hash",
      localReadAt: "2026-10-05T10:00:00Z",
      sourceAsOf: null,
      mode: "frozen-local-snapshot",
    },
    {
      sourceId: "b2b-json",
      sha256: "b2b-hash",
      localReadAt: "2026-10-05T10:01:00Z",
      sourceAsOf: null,
      mode: "frozen-local-snapshot",
    },
  ];
  const views = buildViews({ b2c: b2cFixture, b2b: b2bFixture, sources });

  assert.deepEqual(views.metadata.capturedAt, {
    b2c: "2026-10-05T10:00:00Z",
    b2b: "2026-10-05T10:01:00Z",
  });
  assert.deepEqual(views.metadata.captureMeaning, {
    b2c: "local_import_of_frozen_snapshot",
    b2b: "local_import_of_frozen_snapshot",
  });
  assert.deepEqual(views.metadata.sourceAsOf, { b2c: null, b2b: null });
  assert.deepEqual(views.metadata.sources, sources);
});

test("dates reject invalid months/days and composition windows are capped at 240 months", () => {
  assert.throws(
    () => buildViews({
      b2c: [{ date: "2025-02-30", channel: "A", product: "P", amount_cents: 1 }],
      b2b: [],
    }),
    /invalid ISO date/u,
  );
  assert.throws(
    () => buildViews({
      b2c: [{ month: "2025-99", channel: "A", product: "P", amount_cents: 1 }],
      b2b: [],
    }),
    /invalid year or month/u,
  );
  assert.throws(
    () => buildViews({
      b2c: [
        { date: "2000-01-01", channel: "A", product: "P", amount_cents: 1 },
        { date: "2020-02-01", channel: "A", product: "P", amount_cents: 1 },
      ],
      b2b: [],
    }),
    /exceeds 240 months/u,
  );
});

test("license aggregation throws instead of losing Number safe-integer precision", () => {
  const maxSafe = Number.MAX_SAFE_INTEGER;
  assert.throws(
    () => buildViews({
      b2c: [{ date: "2025-01-01", channel: "A", product: "P", amount_cents: 1 }],
      b2b: [
        {
          contract_id: "large-1",
          licenses: maxSafe,
          monthly_minor_units: 1,
          start_date: "2025-01-01",
          status: "ativo",
        },
        {
          contract_id: "large-2",
          licenses: maxSafe,
          monthly_minor_units: 1,
          start_date: "2025-01-01",
          status: "ativo",
        },
      ],
    }),
    /licenses aggregate must be a safe integer/u,
  );
});

test("observed components stay separate from the modeled monthly scenario", () => {
  const views = buildViews({ b2c: b2cFixture, b2b: b2bFixture });

  assert.deepEqual(views.total.observedComponents, {
    b2c: {
      signedCents: "211",
      currency: "BRL",
    },
    b2b: {
      sumMonthlyMinorUnits: "32",
      currency: null,
      count: 4,
      licenses: 10,
    },
  });
  assert.equal(views.total.official, null);
  assert.notEqual(views.total.monthlyComposition, views.total.observedComponents);
  assert.equal(views.total.monthlyComposition.statusFilter, "ativo");
});
