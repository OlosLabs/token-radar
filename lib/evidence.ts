import { fitCurve, curveValue, quantile, trackingDays, maturity, growthInput, marketMedianChange, lexical, clamp, categoryPremiums, price, ageBandPolicy, MAX_VALUE } from './model.ts';
import type { Protocol, Fit } from './model.ts';
import { cohortOdds } from './economics.ts';

// Out-of-sample evidence for every model term, the odds model's Brier score,
// bootstrap coefficient uncertainty and per-row rank stability, and honest
// interval coverage. All arithmetic is deterministic: the bootstrap uses a
// fixed-seed mulberry32 stream, never Math.random or wall-clock state.

const DAY = 86_400_000;
const capLog = (p: Protocol) => Math.log(p.mcap_usd!);

const hasToken = (p: Protocol) => p.gecko_id !== null || p.symbol !== null || (p.mcap_usd ?? 0) > 0;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Value-model ablation: add one term at a time; a term is kept only when it
// lowers the median absolute multiplicative miss in BOTH leave-one-out and
// the walk-forward time split. A negative control (another row's growth)
// must not help; if it does, the test itself is suspect and we say so.
// ---------------------------------------------------------------------------

interface AblationRow {
  term: string; loo_miss: number; wf_miss: number; kept: boolean; control?: boolean;
}

type Variant = (p: Protocol, train: Protocol[], fit: Fit, median: number, asOf: string, controlGrowth?: number) => number;

const flatBaseline: Variant = (p, train) =>
  Math.log(p.tvl_usd) + quantile(train.map(t => capLog(t) - Math.log(t.tvl_usd)), 0.5);
const sizeCurve: Variant = (p, _train, fit) => Math.log(curveValue(p.tvl_usd, fit));
const plusGrowth: Variant = (p, _train, fit, median) =>
  Math.log(curveValue(p.tvl_usd, fit)) + fit.momentum * growthInput(p, median);
const plusAge: Variant = (p, _train, fit, median, asOf) =>
  plusGrowth(p, _train, fit, median, asOf) + Math.log(maturity(trackingDays(p, asOf)));
const plusControl: Variant = (p, _train, fit, median, _asOf, controlGrowth = 0) =>
  Math.log(curveValue(p.tvl_usd, fit)) + fit.momentum * clamp(controlGrowth / 30, -1, 1);

function categoryPremiumsLocal(peers: Protocol[], fit: Fit, median: number): Map<string, number> {
  const gaps = new Map<string, number[]>();
  for (const p of peers) {
    if (!p.category) continue;
    const gap = capLog(p) - Math.log(curveValue(p.tvl_usd, fit)) - fit.momentum * growthInput(p, median);
    if (!gaps.has(p.category)) gaps.set(p.category, []);
    gaps.get(p.category)!.push(gap);
  }
  const out = new Map<string, number>();
  for (const [c, xs] of gaps) {
    const raw = Math.exp(quantile(xs, 0.5));
    const w = xs.length / (xs.length + 5);
    out.set(c, clamp(1 + w * (raw - 1), 0.5, 2));
  }
  return out;
}

const plusCategory: Variant = (p, train, fit, median) => {
  const premiums = categoryPremiumsLocal(train, fit, median);
  const f = (p.category && premiums.get(p.category)) || 1;
  return plusGrowth(p, train, fit, median, '') + Math.log(f);
};
const plusChains: Variant = (p, train, fit, median) => {
  // Chain-count term: refit a slope on ln(chains) of the training residuals.
  const resid = train.map(t => capLog(t) - plusGrowth(t, train, fit, median, ''));
  const xs = train.map(t => Math.log(Math.max(1, t.chains.length)));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = resid.reduce((a, b) => a + b, 0) / resid.length;
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (resid[i] - my); den += (xs[i] - mx) ** 2; }
  const beta = den > 0 ? clamp(num / (den + 8), -0.5, 0.5) : 0;
  return plusGrowth(p, train, fit, median, '') + beta * (Math.log(Math.max(1, p.chains.length)) - mx);
};

function medianMiss(errors: number[]) {
  return Math.exp(quantile(errors.map(Math.abs), 0.5));
}

const modes = ['Flat median multiple', 'Full conditional cap', 'Without TVL', 'Without growth', 'Without seasoning', 'Without category', 'Shuffled growth control'] as const;
function conditionalFold(train: Protocol[], test: Protocol[], asOf: string) {
  const median = marketMedianChange(train);
  const full = fitCurve(train, true, median);
  const noTvl = fitCurve(train, true, median, false);
  const noGrowth = fitCurve(train, false, median);
  const premiums = categoryPremiums(train, full);
  const tvlPremiums = categoryPremiums(train, noTvl);
  const growthPremiums = categoryPremiums(train, noGrowth);
  const flat = quantile(train.map(t => capLog(t) - Math.log(t.tvl_usd)), 0.5);
  const rand = mulberry32(0xA81A710);
  const growth = train.map(t => t.change_7d);
  for (let i = growth.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [growth[i], growth[j]] = [growth[j], growth[i]];
  }
  const shuffled = train.map((t, i) => ({ ...t, change_7d: growth[i] }));
  const controlFit = fitCurve(shuffled, true, median);
  const controlPremiums = categoryPremiums(shuffled, controlFit);
  return test.map(p => {
    const priced = price(p, asOf, full, premiums);
    let seed = 0xA81A710;
    for (const c of p.slug) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619);
    const control = { ...p, change_7d: growth[Math.floor(mulberry32(seed)() * growth.length)] };
    return [Math.log(p.tvl_usd) + flat, Math.log(priced.value),
      Math.log(price(p, asOf, noTvl, tvlPremiums).value), Math.log(price(p, asOf, noGrowth, growthPremiums).value),
      Math.log(clamp(Math.round(priced.curve * priced.growth * priced.premium), 1, MAX_VALUE)), Math.log(price(p, asOf, full).value),
      Math.log(price(control, asOf, controlFit, controlPremiums).value)];
  });
}

function dateSplit(peers: Protocol[]) {
  const dated = peers.filter(p => p.listed_at !== null)
    .sort((a, b) => lexical(a.listed_at!, b.listed_at!) || lexical(a.slug, b.slug));
  const cut = Math.floor(dated.length / 2);
  return [dated.slice(0, cut), dated.slice(cut)] as const;
}

export function productionAblation(peers: Protocol[], asOf: string) {
  const [train, test] = dateSplit(peers);
  const errors = (targets: Protocol[], predictions: number[][]) =>
    predictions.map((row, i) => row.map(pred => capLog(targets[i]) - pred));
  const loo = errors(peers, peers.map((p, i) => conditionalFold(peers.filter((_, j) => i !== j), [p], asOf)[0]));
  const split = train.length >= 2 ? errors(test, conditionalFold(train, test, asOf)) : [];
  const miss = (xs: number[][], i: number) => xs.length ? medianMiss(xs.map(x => x[i])) : null;
  return { loo_n: loo.length, train_n: train.length, split_n: split.length,
    rows: modes.map((term, i) => ({ term, loo: miss(loo, i), split: miss(split, i) })),
    design: 'Fixed identical folds; fold-local median and category premiums. Removing TVL or growth refits the curve and premiums; seasoning/category are neutralized. Control permutes training growth and assigns held-out growth by a seeded slug draw from training. Odds excluded: target is traded conditional cap.' };
}

export function coverageFold(train: Protocol[], test: Protocol[], asOf: string, oddsUniverse: Protocol[] = train) {
  const median = marketMedianChange(train);
  const fit = fitCurve(train, true, median);
  const premiums = categoryPremiums(train, fit);
  // Recreate the shipped age-band estimator using inner-LOO growth-only errors.
  const calibrationErrors = train.map((p, i) => {
    const inner = train.filter((_, j) => j !== i);
    const f = fitCurve(inner, true, marketMedianChange(inner));
    return Math.abs(capLog(p) - f.intercept - f.slope * Math.log(p.tvl_usd / 100_000_000) - f.momentum * growthInput(p, f.median));
  });
  const { bucketLabel, bandFor } = ageBandPolicy(train, asOf, calibrationErrors);
  const oddsModel = cohortOdds(oddsUniverse, asOf);
  return test.map(p => {
    const age = trackingDays(p, asOf);
    const conditional = price(p, asOf, fit, premiums).value;
    const odds = oddsModel.oddsFor(age);
    const implied = clamp(Math.round(conditional * odds), 1, MAX_VALUE);
    const factor = bandFor(age);
    const bucket = bucketLabel(age);
    const low = Math.max(1, Math.floor(implied / factor));
    const high = Math.min(MAX_VALUE, Math.ceil(implied * factor));
    const conditionalLow = Math.max(1, Math.floor(conditional / factor));
    const conditionalHigh = Math.min(MAX_VALUE, Math.ceil(conditional * factor));
    return { slug: p.slug, conditional, odds, implied, factor, bucket, low, high,
      hit: p.mcap_usd! >= low && p.mcap_usd! <= high,
      conditionalHit: p.mcap_usd! >= conditionalLow && p.mcap_usd! <= conditionalHigh };
  });
}

export function nestedCoverage(protocols: Protocol[], peers: Protocol[], asOf: string) {
  const dated = peers.filter(p => p.listed_at !== null)
    .sort((a, b) => lexical(a.listed_at!, b.listed_at!) || lexical(a.slug, b.slug));
  const cut = Math.floor(dated.length / 2);
  const train = dated.slice(0, cut), test = dated.slice(cut);
  const loo = peers.flatMap((p, i) => coverageFold(peers.filter((_, j) => j !== i), [p], asOf, protocols.filter(x => x.slug !== p.slug)));
  const cutoff = train.at(-1)?.listed_at ?? '';
  const datedUniverse = protocols.filter(p => p.listed_at !== null && p.listed_at <= cutoff);
  const split = train.length >= 3 ? coverageFold(train, test, asOf, datedUniverse) : [];
  const count = (xs: typeof loo, key: 'hit' | 'conditionalHit' = 'hit') => ({ n: xs.length, hits: xs.filter(x => x[key]).length });
  const buckets = [...new Set([...loo, ...split].map(x => x.bucket))];
  return { nominal: 0.8, loo: count(loo), split: count(split),
    conditional: { loo: count(loo, 'conditionalHit'), split: count(split, 'conditionalHit') },
    buckets: buckets.map(bucket => ({ bucket, loo: count(loo.filter(x => x.bucket === bucket)), split: count(split.filter(x => x.bucket === bucket)),
      conditional_loo: count(loo.filter(x => x.bucket === bucket), 'conditionalHit'), conditional_split: count(split.filter(x => x.bucket === bucket), 'conditionalHit') })),
    design: 'Exact dossier-range policy: inner-LOO curve+growth errors estimate age bands and shrinkage; outer test rows are excluded from model, band and odds fits. Hits test the odds-weighted printed range against recorded traded caps; conditional-cap coverage is shown separately. LOO and date-split are cross-sectional snapshot diagnostics, not future-launch calibration.' };
}

export function ablation(peers: Protocol[], asOf: string, median: number) {
  const dated = peers.filter(p => p.listed_at !== null)
    .sort((a, b) => lexical(a.listed_at!, b.listed_at!) || lexical(a.slug, b.slug));
  const cut = Math.floor(dated.length / 2);
  const wfTrain = dated.slice(0, cut), wfTest = dated.slice(cut);
  // Deterministic negative control: each test peer receives the growth of the
  // peer two positions away in slug order — unrelated to its own outcome.
  const bySlug = [...peers].sort((a, b) => lexical(a.slug, b.slug));
  const controlOf = new Map(bySlug.map((p, i) => [p.slug, bySlug[(i + 2) % bySlug.length].change_7d ?? 0]));

  const terms: { term: string; fn: Variant; control?: boolean }[] = [
    { term: 'Flat median multiple', fn: flatBaseline },
    { term: '+ size curve, ln TVL', fn: sizeCurve },
    { term: '+ 7-day relative growth', fn: plusGrowth },
    { term: '+ category premium (shrunk)', fn: plusCategory },
    { term: '+ tracking age (maturity)', fn: plusAge },
    { term: '+ chain count, ln', fn: plusChains },
    { term: '+ control: another row\u2019s growth', fn: plusControl, control: true },
  ];

  const rows: AblationRow[] = terms.map(({ term, fn, control }) => {
    const looErrors = peers.map((p, i) => {
      const train = peers.filter((_, j) => i !== j);
      const fit = fitCurve(train, true, median);
      return capLog(p) - fn(p, train, fit, median, asOf, controlOf.get(p.slug));
    });
    const wfFit = fitCurve(wfTrain, true, median);
    const wfErrors = wfTest.map(p => capLog(p) - fn(p, wfTrain, wfFit, median, asOf, controlOf.get(p.slug)));
    return { term, loo_miss: medianMiss(looErrors), wf_miss: medianMiss(wfErrors), kept: false, ...(control ? { control: true } : {}) };
  });

  // Keep a term only if it beats the running best in BOTH tests. The control
  // is never kept; it is reported against the model without it.
  let bestLoo = rows[0].loo_miss, bestWf = rows[0].wf_miss;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.control) continue;
    if (r.loo_miss < bestLoo && r.wf_miss < bestWf) {
      r.kept = true; bestLoo = r.loo_miss; bestWf = r.wf_miss;
    }
  }
  // The shipped curve is size + growth (momentum is a bounded projection, not
  // a selected fit). The control is judged against that shipped model.
  const modelRow = rows[2];
  const controlRow = rows.at(-1)!;
  return {
    rows, baseline: rows[0],
    model_loo: modelRow.loo_miss, model_wf: modelRow.wf_miss,
    kept_terms: rows.filter(r => r.kept).map(r => r.term),
    control_loo_delta: controlRow.loo_miss - modelRow.loo_miss,
    control_wf_delta: controlRow.wf_miss - modelRow.wf_miss,
    control_helps: controlRow.loo_miss < modelRow.loo_miss && controlRow.wf_miss < modelRow.wf_miss,
    design: 'Candidate variants refit per LOO fold and tracking-date split, not a full-production ablation. Pass flags require both misses to improve; they do not select shipped terms. The board retains bounded growth, seasoning and category sensitivities. Control deltas compare to curve + growth, not the full shipped valuation.',
  };
}

// ---------------------------------------------------------------------------
// Odds-model Brier score: ten-fold and walk-forward against the base rate.
// ---------------------------------------------------------------------------

export function oddsBrier(protocols: Protocol[], asOf: string) {
  const dated = protocols.filter(p => p.listed_at !== null)
    .sort((a, b) => lexical(a.listed_at!, b.listed_at!) || lexical(a.slug, b.slug));
  const outcome = (p: Protocol) => hasToken(p) ? 1 : 0;
  const ageOf = (p: Protocol) => (Date.parse(asOf) - Date.parse(p.listed_at!)) / DAY;

  // Ten-fold: deterministic slug-ordered folds.
  const bySlug = [...dated].sort((a, b) => lexical(a.slug, b.slug));
  const folds: Protocol[][] = Array.from({ length: 10 }, () => []);
  bySlug.forEach((p, i) => folds[i % 10].push(p));
  let modelSq = 0, baseSq = 0, modelRight = 0, baseRight = 0, n = 0;
  for (let k = 0; k < 10; k++) {
    const test = folds[k];
    const train = bySlug.filter(p => !test.includes(p));
    const odds = cohortOdds(train, asOf);
    const base = train.reduce((s, p) => s + outcome(p), 0) / train.length;
    for (const p of test) {
      const y = outcome(p), pm = odds.oddsFor(ageOf(p));
      modelSq += (pm - y) ** 2; baseSq += (base - y) ** 2;
      if ((pm >= 0.5 ? 1 : 0) === y) modelRight++;
      if ((base >= 0.5 ? 1 : 0) === y) baseRight++;
      n++;
    }
  }
  // Walk-forward: oldest half predicts newest half.
  const cut = Math.floor(dated.length / 2);
  const train = dated.slice(0, cut), test = dated.slice(cut);
  const odds = cohortOdds(train, asOf);
  const base = train.reduce((s, p) => s + outcome(p), 0) / train.length;
  let wModelSq = 0, wBaseSq = 0, wModelRight = 0, wBaseRight = 0;
  for (const p of test) {
    const y = outcome(p), pm = odds.oddsFor(ageOf(p));
    wModelSq += (pm - y) ** 2; wBaseSq += (base - y) ** 2;
    if ((pm >= 0.5 ? 1 : 0) === y) wModelRight++;
    if ((base >= 0.5 ? 1 : 0) === y) wBaseRight++;
  }
  const launched = dated.reduce((s, p) => s + outcome(p), 0);
  return {
    n_peers: dated.length, n_launched: launched,
    tenfold: { n, model_brier: modelSq / n, base_brier: baseSq / n, model_called_right: modelRight / n, base_called_right: baseRight / n },
    walk_forward: { n: test.length, model_brier: wModelSq / test.length, base_brier: wBaseSq / test.length, model_called_right: wModelRight / test.length, base_called_right: wBaseRight / test.length },
    design: 'Ten slug-ordered folds and an oldest-half/newest-half time split. The base rate is the training share with a recorded token; the model is the isotonic age curve refit on the same training rows. Brier: mean squared error of the probability, lower is better.',
  };
}

// ---------------------------------------------------------------------------
// Bootstrap: 200 fixed-seed refits of the peer sample. Coefficient standard
// errors and each board row's rank range across refits.
// ---------------------------------------------------------------------------

export function bootstrap(peers: Protocol[], asOf: string, median: number, rowInputs: { slug: string; tvl_usd: number; change_7d: number | null; category: string | null; age_days: number | null; launch_odds: number }[], refits = 200) {
  const rand = mulberry32(0x5EED2026);
  const slopes: number[] = [], momenta: number[] = [];
  const intercepts: number[] = [];
  const rankLists = new Map(rowInputs.map(r => [r.slug, [] as number[]]));
  const n = peers.length;
  for (let b = 0; b < refits; b++) {
    const sample: Protocol[] = [];
    for (let i = 0; i < n; i++) sample.push(peers[Math.floor(rand() * n)]);
    let fit: Fit;
    try { fit = fitCurve(sample, true, median); } catch { continue; }
    slopes.push(fit.slope); momenta.push(fit.momentum); intercepts.push(fit.intercept);
    const premiums = categoryPremiumsLocal(sample, fit, median);
    const values = rowInputs.map(r => {
      const curve = curveValue(r.tvl_usd, fit);
      const growth = Math.exp(fit.momentum * growthInput({ change_7d: r.change_7d } as Protocol, median));
      const age = maturity(r.age_days);
      const prem = (r.category && premiums.get(r.category)) || 1;
      return { slug: r.slug, v: curve * growth * age * prem * r.launch_odds };
    }).sort((a, b2) => b2.v - a.v || lexical(a.slug, b2.slug));
    values.forEach((v, i) => rankLists.get(v.slug)!.push(i + 1));
  }
  const se = (xs: number[]) => {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
  };
  const rank_range: Record<string, [number, number]> = {};
  for (const [slug, ranks] of rankLists) {
    if (ranks.length) rank_range[slug] = [Math.min(...ranks), Math.max(...ranks)];
  }
  return {
    refits: slopes.length, seed: '0x5EED2026 (mulberry32, fixed)',
    slope_se: se(slopes), momentum_se: se(momenta), intercept_se: se(intercepts),
    slope_p10_p90: [quantile(slopes, 0.1), quantile(slopes, 0.9)],
    rank_range,
    design: '200 bootstrap resamples of the traded-peer set, refit end to end (curve, premiums), re-pricing every board row at its published odds. Rank range is the min–max across refits, not a confidence interval.',
  };
}

// ---------------------------------------------------------------------------
// Interval coverage: do the printed bands hold the stated share of real caps?
// ---------------------------------------------------------------------------

export function coverage(peers: Protocol[], asOf: string, median: number, bandFactor: number) {
  const folds = peers.map((p, i) => {
    const train = peers.filter((_, j) => i !== j);
    const fit = fitCurve(train, true, median);
    const pred = Math.log(curveValue(p.tvl_usd, fit)) + fit.momentum * growthInput(p, median);
    return Math.abs(capLog(p) - pred);
  });
  const dated = peers.filter(p => p.listed_at !== null)
    .sort((a, b) => lexical(a.listed_at!, b.listed_at!) || lexical(a.slug, b.slug));
  const cut = Math.floor(dated.length / 2);
  const wfFit = fitCurve(dated.slice(0, cut), true, median);
  const wf = dated.slice(cut).map(p =>
    Math.abs(capLog(p) - Math.log(curveValue(p.tvl_usd, wfFit)) - wfFit.momentum * growthInput(p, median)));
  const share = (xs: number[], f: number) => xs.filter(e => e <= Math.log(f)).length / xs.length;
  const band50 = Math.exp(quantile(folds, 0.5));
  return {
    stated_80_factor: bandFactor,
    loo: { within_x3: share(folds, 3), inside_stated_80: share(folds, bandFactor), inside_median_band: share(folds, band50) },
    wf: { within_x3: share(wf, 3), inside_stated_80: share(wf, bandFactor), inside_median_band: share(wf, band50) },
    median_band_factor: band50,
    design: 'Global curve + growth log-error diagnostics on traded caps: no seasoning, category premiums, odds or age-matched dossier bands. LOO-derived global factors are reused for the tracking-date split; not full-production or future-launch calibration.',
  };
}

// ---------------------------------------------------------------------------
// Full snapshot accounting: every protocol in exactly one group.
// ---------------------------------------------------------------------------

export function accounting(protocols: Protocol[], watch: Set<string>, rankedSlugs: Set<string>, classifyFn: (p: Protocol, w: Set<string>) => string, floorUsd: number) {
  const groups = {
    ranked_watchlist: 0, ranked_below_floor: 0, ranked_other: 0,
    recorded_priced: 0, recorded_unpriced: 0,
    out_bridge: 0, out_staking: 0, out_exchange: 0, out_versioned: 0, out_other: 0,
  };
  const bridge = /^(?:Bridge|Canonical Bridge|Cross Chain Bridge)$/i;
  const staking = /^(?:Liquid Staking|Liquid Restaking|Restaked BTC|Anchor BTC|Decentralized BTC|Stablecoin Wrapper|Staking Pool)$/i;
  const exchange = /^(?:Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
  const versioned = /\s(?:v\d+(?:\.\d+)*|\d+\.\d+)$/i;
  const wrapped = /\b(?:wrapped|staked|staking)\b/i;
  for (const p of protocols) {
    if (rankedSlugs.has(p.slug)) {
      if (watch.has(p.slug)) groups.ranked_watchlist++;
      else if (p.tvl_usd < floorUsd) groups.ranked_below_floor++;
      else groups.ranked_other++;
      continue;
    }
    if (hasToken(p)) {
      if ((p.mcap_usd ?? 0) > 0) groups.recorded_priced++; else groups.recorded_unpriced++;
      continue;
    }
    const c = p.category ?? '';
    if (bridge.test(c)) groups.out_bridge++;
    else if (staking.test(c)) groups.out_staking++;
    else if (exchange.test(p.name) || /^CEX$/i.test(c)) groups.out_exchange++;
    else if (versioned.test(p.name) || wrapped.test(p.name)) groups.out_versioned++;
    else groups.out_other++;
  }
  const total = Object.values(groups).reduce((a, b) => a + b, 0);
  if (total !== protocols.length) throw new Error(`Accounting mismatch: ${total} != ${protocols.length}`);
  return { groups, total, reconciles: total === protocols.length };
}