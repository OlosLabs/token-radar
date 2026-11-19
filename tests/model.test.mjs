import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { buildRadar, clamp, fitCurve, parseSnapshot, price, quantile, trackingDays, maturity } from '../lib/model.ts';
import { farmPlan } from '../lib/farm.ts';
import scenario from '../dashboard/scenario.js';
const { defaults, economics } = scenario;

const snapshotPath = resolve(import.meta.dirname, '../../kit/token-radar-01-kit/input/snapshot.json');
const source = readFileSync(snapshotPath, 'utf8');
const snapshot = parseSnapshot(source);
const radar = buildRadar(snapshot);
const bySlug = new Map(snapshot.protocols.map(p => [p.slug, p]));

test('kit snapshot bytes and source identity are preserved', () => {
  const manifest = JSON.parse(readFileSync(resolve(snapshotPath, '../../kit.json'), 'utf8'));
  const entry = manifest.files.find(file => file.path === 'input/snapshot.json');
  assert.equal(Buffer.byteLength(source), entry.size);
  assert.equal(createHash('sha256').update(source).digest('hex'), entry.sha256);
  assert.equal(snapshot.as_of, '2026-11-14');
  assert.equal(snapshot.protocols.length, 758);
  assert.equal(snapshot.watchlist.length, 40);
  assert.equal(snapshot.protocols.find(p => p.slug === 'autofinance').mcap_usd, -1);
});

test('all watchlist records and at least 60 additional eligible discoveries rank', () => {
  assert.equal(radar.rows.length, 190);
  assert.equal(radar.counts.covered, 40);
  assert.equal(radar.counts.discovery, 150);
  assert.ok(snapshot.watchlist.every(slug => radar.rows.some(p => p.slug === slug)));
  assert.ok(radar.rows.some(p => p.tvl_usd < snapshot.floor_usd));
  assert.equal(new Set(radar.rows.map(p => p.slug)).size, radar.rows.length);
});

test('ranks are contiguous with positive integer values in descending order', () => {
  radar.rows.forEach((row, index) => {
    assert.equal(row.rank, index + 1);
    assert.ok(Number.isSafeInteger(row.implied_value_usd) && row.implied_value_usd > 0);
    assert.ok(row.implied_value_usd <= 100_000_000_000_000);
    if (index) assert.ok(radar.rows[index - 1].implied_value_usd >= row.implied_value_usd);
  });
  assert.ok(new Set(radar.rows.map(p => p.implied_value_usd)).size > 1);
});

test('every farm plan is row-specific enough to identify its protocol, cost and duration', () => {
  const plans = new Map();
  for (const row of radar.rows) {
    assert.ok(row.farm_steps.length >= 3 && row.farm_steps.length <= 12, row.slug);
    assert.ok(row.farm_steps.every(s => s.trim().length >= 20 && s.trim().length <= 600), row.slug);
    assert.ok(row.farm_steps[0].includes(row.name), row.slug);
    assert.ok(row.farm_steps.some(s => /\$\d/.test(s) && /min|day|weekly/i.test(s)), row.slug);
    assert.equal(typeof row.plan.research, 'boolean');
    plans.set(row.slug, row.plan.title);
  }
  assert.equal(plans.size, radar.rows.length);
  assert.ok(radar.rows.some(row => row.plan.research));
});

test('curve estimate demonstrably responds to snapshot TVL, growth and tracking duration', () => {
  const p = bySlug.get('steakhouse-financial');
  const baseline = price(p, snapshot.as_of, radar.fit);
  assert.ok(baseline.value > 0);
  assert.notEqual(price({ ...p, tvl_usd: p.tvl_usd * 2 }, snapshot.as_of, radar.fit).value, baseline.value);
  assert.notEqual(price({ ...p, change_7d: p.change_7d + 10 }, snapshot.as_of, radar.fit).value, baseline.value);
  const duration = price({ ...p, listed_at: '2020-01-01' }, snapshot.as_of, radar.fit);
  assert.notEqual(duration.age_days, baseline.age_days);
  assert.notEqual(duration.age, baseline.age);
});

test('leave-one-out baseline, growth ablation and held-out sensitivity are explicit and bounded', () => {
  assert.equal(radar.validation.folds, radar.peers.length);
  assert.ok(radar.peers.length >= 80);
  assert.ok(Number.isFinite(radar.validation.miss.baseline));
  assert.ok(Number.isFinite(radar.validation.miss.tvl));
  assert.ok(Number.isFinite(radar.validation.miss.growth));
  assert.ok(radar.validation.miss.baseline > 1);
  assert.ok(radar.validation.factor > 1);
  assert.ok(radar.validation.coverage >= 0.7 && radar.validation.coverage <= 0.9);
  assert.ok(radar.rows.every(p => p.comparables.length === 3));
  const extrapolation = radar.rows.find(p => p.extrapolated);
  if (extrapolation) assert.ok(extrapolation.range[1] > extrapolation.range[0]);
});

test('seven-day null is neutral; annualized tracking date has a labelled fallback', () => {
  const unknown = { ...bySlug.get('steakhouse-financial'), change_7d: null, listed_at: null };
  const output = price(unknown, snapshot.as_of, radar.fit);
  assert.equal(output.growth, 1);
  assert.equal(output.age_days, null);
  assert.ok(Math.abs(output.age - 0.91) < 1e-12);
});

test('snapshot adapter rejects malformed or fabricated records', () => {
  assert.throws(() => parseSnapshot('{"as_of":"2026-11-14"}'), /Snapshot needs/);
  const badSlug = JSON.parse(source); badSlug.protocols[0].slug = badSlug.protocols[1].slug;
  assert.throws(() => parseSnapshot(JSON.stringify(badSlug)), /Invalid or duplicate protocol/);
  const badWatch = JSON.parse(source); badWatch.watchlist.push('invented-protocol');
  assert.throws(() => parseSnapshot(JSON.stringify(badWatch)), /Inconsistent watchlist/);
  const badName = JSON.parse(source); badName.protocols[0].name = ' ';
  assert.throws(() => parseSnapshot(JSON.stringify(badName)), /Invalid or duplicate protocol/);
  const badDate = JSON.parse(source); badDate.protocols[0].listed_at = 'not-a-date';
  assert.throws(() => parseSnapshot(JSON.stringify(badDate)), /Invalid or duplicate protocol/);
});

test('farm templates depend on protocol and sector; the snapshot does not assert campaigns', () => {
  const a = farmPlan(bySlug.get('steakhouse-financial'), null);
  const b = farmPlan(bySlug.get('lightning-network'), null);
  assert.equal(a.research, true);
  assert.equal(b.research, true);
  assert.notDeepEqual(a.steps, b.steps);
  assert.equal(a.evidence.deployment, 'unknown');
  assert.equal(a.evidence.exit, 'unknown');
  assert.ok(a.steps.some(step => /eligibility/i.test(step.action)));
});

test('the pure farm scenario changes consistently with joint probability and fees', () => {
  const row = radar.rows[0];
  const s = { ...defaults, whatif: 1, pool: 1000000, deposits: 10000000 };
  const base = economics(row, s);
  const noOdds = economics(row, { ...s, prob: 0 });
  const highFees = economics(row, { ...s, fixed: 20, weekly: 4 });
  assert.ok(base.expected > noOdds.expected);
  assert.equal(noOdds.expected, 0);
  assert.ok(highFees.cost > base.cost);
  assert.equal(base.breakEven, base.conditional > 0 ? 100 * base.cost / base.conditional : null);
  assert.equal(economics({ ...row, plan: { ...row.plan, research: true } }, defaults), null);
});

test('every source plan validates; review order starts top ten then deduplicated complete watchlist', () => {
  assert.equal(radar.plan_audit.validated_source_rows, snapshot.protocols.length);
  assert.deepEqual(radar.plan_audit.review_order.slice(0, 10), radar.rows.slice(0, 10).map(r => r.slug));
  assert.equal(new Set(radar.plan_audit.review_order).size, radar.plan_audit.review_order.length);
  assert.ok(snapshot.watchlist.every(slug => radar.plan_audit.review_order.includes(slug)));
  const signatures = new Set();
  for (const p of snapshot.protocols) {
    const plan = farmPlan(p, trackingDays(p, snapshot.as_of));
    assert.ok(plan.research, p.slug);
    for (const key of ['deployment', 'asset', 'eligibility', 'exit']) assert.equal(plan.evidence[key], 'unknown');
    assert.ok(plan.steps.length >= 3 && plan.steps.length <= 12);
    for (const s of plan.steps) {
      const text = `${s.title} (${s.when}; ${s.time}; ${s.cost}): ${s.action}`;
      assert.ok(text.trim().length >= 20 && text.trim().length <= 600, `${p.slug}: ${text.length}`);
    }
    assert.ok(plan.steps.some(s => /skip/i.test(s.action)), p.slug);
    assert.ok(plan.steps.some(s => s.action.includes(p.slug)), p.slug);
    signatures.add(JSON.stringify(plan.steps));
  }
  assert.equal(signatures.size, snapshot.protocols.length);
});

test('explicit hypothetical pool/deposits never depend on market cap or TVL, including sensitivity and zero cases', () => {
  const row = radar.rows[0];
  const s = { ...defaults, whatif: 1, pool: 1000000, deposits: 10000000 };
  const e = economics(row, s);
  assert.equal(e.share, 250 / 10000000);
  assert.equal(e.conditional, 25);
  assert.equal(e.expected, 2.5);
  assert.ok(Math.abs(e.expectedNet - (e.expected - e.fixed - e.friction - e.recurring - e.opportunity)) < 1e-12);
  assert.deepEqual(economics({ ...row, tvl_usd: 1, implied_value_usd: 999999999 }, s), e);
  assert.equal(economics(row, s, 0.5).conditional, 12.5);
  assert.equal(economics(row, s, 2).conditional, 50);
  assert.ok(economics(row, { ...s, fixed: 100 }).breakEven > 100);
  assert.equal(economics(row, { ...s, pool: 0 }).conditional, 0);
  assert.equal(economics(row, { ...s, pool: 0 }).breakEven, null);
  assert.equal(economics(row, { ...s, pool: 0, fixed: 0, bps: 0, annual: 0 }).breakEven, 0);
  for (const overrides of [{ whatif: 0 }, { deposits: 0 }, { capital: 0 }, { pool: -1 }, { prob: NaN }]) {
    assert.equal(economics(row, { ...s, ...overrides }), null);
  }
  // Explicit synthetic test: a verified route can calculate without the research override.
  assert.ok(economics({ ...row, plan: { ...row.plan, research: false } }, { ...s, whatif: 0 }));
});

test('same-fold residuals independently reproduce held-out estimates and error summaries', () => {
  const v = radar.validation;
  assert.deepEqual(v.residuals.map(f => f.slug), radar.peers.map(p => p.slug));
  for (const [i, peer] of radar.peers.entries()) {
    const train = radar.peers.filter((_, j) => i !== j), full = fitCurve(train), simple = fitCurve(train, false);
    const y = Math.log(peer.mcap_usd), x = Math.log(peer.tvl_usd / 100000000);
    const g = clamp(peer.change_7d ?? 0, -30, 30) / 30;
    assert.ok(Math.abs(v.residuals[i].growth - (y - full.intercept - full.slope*x - full.momentum*g)) < 1e-12);
    assert.ok(Math.abs(v.residuals[i].age - (y - simple.intercept - simple.slope*x - Math.log(maturity(trackingDays(peer, snapshot.as_of))))) < 1e-12);
  }
  for (const key of ['baseline', 'tvl', 'growth', 'age', 'full']) {
    assert.equal(v.diagnostics[key].n, radar.peers.length);
    assert.equal(v.miss[key], Math.exp(quantile(v.residuals.map(f => Math.abs(f[key])), 0.5)));
    assert.ok(v.diagnostics[key].residual_p10_p90[0] < v.diagnostics[key].residual_p10_p90[1]);
  }
  assert.equal(v.top_rank_sensitivity.length, 10);
});

test('small deterministic utilities respect bounds', () => {
  assert.equal(clamp(200, 0, 100), 100);
  assert.equal(clamp(-1, 0, 100), 0);
  assert.equal(quantile([4, 1, 3, 2], 0.5), 2.5);
  assert.ok(fitCurve(radar.peers).slope >= 0);
});
