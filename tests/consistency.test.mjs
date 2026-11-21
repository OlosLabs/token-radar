import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildRadar, parseSnapshot, fitCurve, curveValue, growthInput, quantile } from '../lib/model.ts';
import { farmEconomics } from '../lib/economics.ts';
const snapshot = parseSnapshot(readFileSync(new URL('../../kit/token-radar-01-kit/input/snapshot.json', import.meta.url), 'utf8'));
const radar = buildRadar(snapshot);
const window = { FIELD: radar };
vm.runInNewContext(readFileSync(new URL('../dashboard/recompute.js', import.meta.url), 'utf8'), { window });
const R = window.Recompute;
const fields = ['deposit','gasTxs','fees','incomeForgone','sliceIfLaunch','expected','net','netAfterYield','breakEvenOdds','minutes','netPerHour','verdict','skipReason','reviewDate'];
const plain = x => JSON.parse(JSON.stringify(x));
function matches(row, scenario, protocol = row) {
  const expected = farmEconomics(protocol, { asOf: radar.as_of, impliedValue: row.conditional_value_usd, odds: row.launch_odds,
    capital: scenario.capital, days: scenario.days, airdropShare: scenario.share, altYield: scenario.alt });
  const live = R.farmRow(row, scenario);
  for (const key of fields) assert.deepEqual(plain(live[key]), plain(expected[key]), `${row.slug} ${JSON.stringify(scenario)} ${key}`);
}
test('browser economics exactly match build fields for all 203 rows at defaults and joint edits', () => {
  for (const row of radar.rows) {
    assert.ok(R.verify(row).impliedMatch && R.verify(row).conditionalMatch);
    matches(row, {});
    matches(row, { capital: 5000, days: 168, share: 0.15, alt: 0.08 });
    matches(row, { capital: 100, days: 7, share: 0.01, alt: 0 });
  }
});
test('explicit synthetic sub-cent cap fixture floors deposit; rounded break-even and zero slice match', () => {
  const base = radar.rows.find(r => r.category === 'Lending');
  const row = { ...base, tvl_usd: 1234.567, conditional_value_usd: 1000 };
  matches(row, { capital: 5000 });
  assert.equal(R.farmRow(row, { capital: 5000 }).deposit, 24.69);
  assert.ok(R.farmRow(row, { capital: 5000 }).deposit <= row.tvl_usd * 0.02);
  matches(row, { capital: 0 });
  assert.equal(R.farmRow(row, { capital: 0 }).breakEvenOdds, null);
});
test('negative-control deltas independently reconcile; improves LOO but worsens date split', () => {
  const a = radar.validation.term_ablation, control = a.rows.find(r => r.control), curveGrowth = a.rows[2];
  assert.equal(a.control_loo_delta, control.loo_miss - curveGrowth.loo_miss);
  assert.equal(a.control_wf_delta, control.wf_miss - curveGrowth.wf_miss);
  assert.ok(a.control_loo_delta < 0 && a.control_wf_delta > 0);
  assert.equal(a.control_helps, false);
  // Experiments do not remove the shipped growth/age factors; the category
  // premium was removed in v8 after both held-out tests worsened with it.
  assert.ok(radar.rows.some(r => r.factors.growth !== 1 && r.factors.age !== 1));
  assert.ok(radar.rows.every(r => r.factors.premium === 1));
});
test('coverage is independently reproduced from global curve + growth errors, not dossier bands', () => {
  const peers = radar.peers, median = radar.market_median_change_7d;
  const errors = peers.map((p, i) => {
    const fit = fitCurve(peers.filter((_, j) => i !== j), true, median);
    return Math.abs(Math.log(p.mcap_usd) - Math.log(curveValue(p.tvl_usd, fit)) - fit.momentum * growthInput(p, median));
  });
  const c = radar.validation.interval_coverage;
  assert.equal(c.loo.inside_stated_80, errors.filter(e => e <= Math.log(c.stated_80_factor)).length / peers.length);
  assert.ok(Math.abs(c.median_band_factor - Math.exp(quantile(errors, 0.5))) < 1e-12);
  assert.ok(radar.rows.some(r => r.range_factor !== c.stated_80_factor));
});
