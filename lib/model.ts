import { farmPlan } from './farm.ts';
import { cohortOdds, farmEconomics, ECON_DEFAULTS } from './economics.ts';

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  watchlist: string[];
  protocols: Protocol[];
}

const DAY = 86_400_000;
const MAX_VALUE = 100_000_000_000_000;
export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const positiveInt = (x: unknown) => Number.isSafeInteger(x) && Number(x) > 0;
const text = (x: unknown): x is string => typeof x === 'string' && !!x.trim();
function date(x: unknown): x is string {
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x) || !Number.isFinite(Date.parse(x))) return false;
  return new Date(x).toISOString().slice(0, 10) === x;
}

export function parseSnapshot(raw: string): Snapshot {
  const s = JSON.parse(raw) as Snapshot;
  if (!s || !date(s.as_of) || !text(s.source) || !positiveInt(s.floor_usd) || !Array.isArray(s.protocols) || !Array.isArray(s.watchlist)) {
    throw new Error('Snapshot needs as_of (UTC date), source, a positive floor_usd, protocols and watchlist.');
  }
  const seen = new Map<string, Protocol>();

  for (const p of s.protocols) {
    if (!p || !text(p.slug) || !/^[^\s]{1,128}$/.test(p.slug) || seen.has(p.slug) || !text(p.name) || !positiveInt(p.tvl_usd) ||
      !Array.isArray(p.chains) || !p.chains.every(text) || ![p.category, p.gecko_id, p.symbol].every(x => x === null || text(x)) ||
      !(p.change_7d === null || Number.isFinite(p.change_7d)) ||
      !(p.mcap_usd === null || (Number.isSafeInteger(p.mcap_usd) && p.mcap_usd >= -1)) ||
      !(p.listed_at === null || (date(p.listed_at) && p.listed_at <= s.as_of))) {
      throw new Error(`Invalid or duplicate protocol record: ${p?.slug ?? '(no slug)'}`);
    }
    seen.set(p.slug, p);
  }
  const watch = new Set<string>();
  for (const slug of s.watchlist) {
    const p = seen.get(slug);
    if (!p || watch.has(slug) || recorded(p) || p.tvl_usd < s.floor_usd) throw new Error(`Inconsistent watchlist slug: ${slug}`);
    watch.add(slug);
  }
  return s;
}

export const recorded = (p: Protocol) => p.gecko_id !== null || p.symbol !== null || (p.mcap_usd ?? 0) > 0;
const product = /^(?:Bridge|Canonical Bridge|Cross Chain Bridge|Liquid Staking|Liquid Restaking|Restaked BTC|CEX|Anchor BTC|Decentralized BTC|Stablecoin Wrapper|Staking Pool)$/i;
const versioned = /\s(?:v\d+(?:\.\d+)*|\d+\.\d+)$/i;
const wrapped = /\b(?:wrapped|staked|staking)\b/i;
const exchange = /^(?:Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

export function classify(p: Protocol, watch: Set<string>) {
  if (recorded(p)) return 'Recorded token';
  if (watch.has(p.slug)) return 'Watchlist';
  if (product.test(p.category ?? '') || wrapped.test(p.name) || exchange.test(p.name)) return 'Product or exchange screen';
  if (versioned.test(p.name)) return 'Versioned product screen';
  return 'Discovery';
}

export function quantile(values: number[], q: number) {
  if (!values.length) throw new Error('Quantile requires observations.');
  const xs = [...values].sort((a, b) => a - b);
  const i = (xs.length - 1) * q;
  return xs[Math.floor(i)] + (xs[Math.ceil(i)] - xs[Math.floor(i)]) * (i % 1);
}

export const trackingDays = (p: Protocol, asOf: string) => p.listed_at === null ? null : (Date.parse(asOf) - Date.parse(p.listed_at)) / DAY;
export const maturity = (days: number | null) => 0.82 + 0.18 * clamp((days ?? 730) / 1460, 0, 1);
export const growthInput = (p: Protocol) => clamp(p.change_7d ?? 0, -30, 30) / 30;
const scale = (p: Protocol) => Math.log(p.tvl_usd / 100_000_000);
const capLog = (p: Protocol) => Math.log(p.mcap_usd!);

// Ridge least squares on centered log TVL and clipped growth. Keep the growth
// coefficient bounded, then re-solve intercept and slope with that coefficient.
export function fitCurve(peers: Protocol[], growth = true) {
  const n = peers.length;
  if (n < 2) throw new Error('Need at least two observations per refit.');
  const mean = (fn: (p: Protocol) => number) => peers.reduce((s, p) => s + fn(p), 0) / n;
  const mx = mean(scale), mg = mean(growthInput), my = mean(capLog);
  let xx = 0, gg = 0, xg = 0, xy = 0, gy = 0;
  for (const p of peers) {
    const x = scale(p) - mx, g = growthInput(p) - mg, y = capLog(p) - my;
    xx += x * x; gg += g * g; xg += x * g; xy += x * y; gy += g * y;
  }
  const a = xx + 2, d = gg + 12;
  const momentum = growth ? clamp((a * gy - xg * xy) / (a * d - xg * xg), -0.25, 0.25) : 0;
  const slope = clamp((xy - xg * momentum) / a, 0, 1.5);
  return { intercept: my - slope * mx - momentum * mg, slope, momentum };
}

export type Fit = ReturnType<typeof fitCurve>;
export function curveValue(tvl: number, fit: Fit) {
  return Math.exp(fit.intercept + fit.slope * Math.log(tvl / 100_000_000));
}

// Category premium: the median gap between a category's traded tokens and the
// fitted curve, shrunk toward 1 when comparables are few (n/(n+5)) and clamped
// to [0.5, 2]. Categories without traded peers keep the neutral premium 1.
export interface Premium { factor: number; n: number; raw: number }
export function categoryPremiums(peers: Protocol[], fit: Fit): Map<string, Premium> {
  const gaps = new Map<string, number[]>();
  for (const p of peers) {
    if (!p.category) continue;
    const gap = capLog(p) - Math.log(curveValue(p.tvl_usd, fit)) - fit.momentum * growthInput(p);
    if (!gaps.has(p.category)) gaps.set(p.category, []);
    gaps.get(p.category)!.push(gap);
  }
  const out = new Map<string, Premium>();
  for (const [category, xs] of [...gaps.entries()].sort((a, b) => lexical(a[0], b[0]))) {
    const raw = Math.exp(quantile(xs, 0.5));
    const weight = xs.length / (xs.length + 5);
    out.set(category, { factor: clamp(1 + weight * (raw - 1), 0.5, 2), n: xs.length, raw });
  }
  return out;
}
export const premiumFor = (premiums: Map<string, Premium>, category: string | null) =>
  (category && premiums.get(category)) || { factor: 1, n: 0, raw: 1 };

export function price(p: Protocol, asOf: string, fit: Fit, premiums?: Map<string, Premium>) {
  const age_days = trackingDays(p, asOf);
  const curve = curveValue(p.tvl_usd, fit);
  const growth = Math.exp(fit.momentum * growthInput(p));
  const age = maturity(age_days);
  const premium = premiums ? premiumFor(premiums, p.category).factor : 1;
  const value = clamp(Math.round(curve * growth * age * premium), 1, MAX_VALUE);
  return { value, curve, growth, age, age_days, premium };
}

function validate(peers: Protocol[], asOf: string) {
  const variants = ['baseline', 'tvl', 'growth', 'age', 'full'] as const;
  const folds = peers.map((p, i) => {
    const train = peers.filter((_, j) => i !== j);
    const fitted = fitCurve(train);
    const x = scale(p);
    const curve = fitted.intercept + fitted.slope * x + fitted.momentum * growthInput(p);
    const simple = fitCurve(train, false);
    const y = capLog(p);
    return {
      slug: p.slug,
      baseline: y - Math.log(p.tvl_usd) - quantile(train.map(t => capLog(t) - Math.log(t.tvl_usd)), 0.5),
      tvl: y - simple.intercept - simple.slope * x,
      growth: y - curve,
      age: y - simple.intercept - simple.slope * x - Math.log(maturity(trackingDays(p, asOf))),
      full: y - curve - Math.log(maturity(trackingDays(p, asOf))),
    };
  });
  const miss = Object.fromEntries(variants.map(k => [k, Math.exp(quantile(folds.map(f => Math.abs(f[k])), 0.5))]));
  // Use symmetric 80% absolute-error band from curve+growth residuals. Age is a
  // separate transfer haircut. Exclude each residual from its own band check.
  const errors = folds.map(f => Math.abs(f.growth));
  const factor = Math.exp(quantile(errors, 0.8));
  const coverage = errors.filter((err, i) => err <= quantile(errors.filter((_, j) => i !== j), 0.8)).length / errors.length;
  const diagnostics = Object.fromEntries(variants.map(k => {
    const residuals = folds.map(f => f[k]);
    return [k, { n: peers.length, median_miss: miss[k],
      mean_log_error: residuals.reduce((a, b) => a + b, 0) / peers.length,
      residual_p10_p90: [quantile(residuals, 0.1), quantile(residuals, 0.9)],
      error_factor_p80: Math.exp(quantile(residuals.map(Math.abs), 0.8)) }];
  }));
  const paired = (a: typeof variants[number], b: typeof variants[number]) => {
    const differences = folds.map(f => Math.abs(f[a]) - Math.abs(f[b]));
    return { a, b, n: differences.length, a_lower_error: differences.filter(d => d < 0).length,
      median_log_error_difference: quantile(differences, 0.5) };
  };
  return { folds: peers.length, miss, factor, coverage, diagnostics, residuals: folds,
    comparisons: [paired('growth', 'tvl'), paired('full', 'growth'), paired('age', 'tvl'), paired('full', 'baseline')],
    design: 'Identical leave-one-token-out folds; fixed candidates, no tuning or model selection. One-date cross-sectional diagnostics, not a historical backtest.',
    limits: 'Overlapping training folds are dependent; paired counts are descriptive, not significance tests. Growth and age are retained as disclosed valuation sensitivities, not proven predictive improvements.' };
}

// Walk-forward time split: fit the curve on the older half of dated traded
// peers, then price the newer half it never saw. Compare the median absolute
// multiplicative miss against a flat log mcap/TVL multiple fitted on the same
// training half. A genuine out-of-sample test in tracking time, though still
// one snapshot date — not a historical price backtest.
export function walkForward(peers: Protocol[], asOf: string) {
  const dated = peers.filter(p => p.listed_at !== null)
    .sort((a, b) => lexical(a.listed_at!, b.listed_at!) || lexical(a.slug, b.slug));
  if (dated.length < 10) return null;
  const cut = Math.floor(dated.length / 2);
  const train = dated.slice(0, cut), test = dated.slice(cut);
  const fitted = fitCurve(train);
  const flat = quantile(train.map(t => capLog(t) - Math.log(t.tvl_usd)), 0.5);
  const errors = test.map(p => ({
    slug: p.slug,
    model: capLog(p) - Math.log(curveValue(p.tvl_usd, fitted)) - fitted.momentum * growthInput(p) - Math.log(maturity(trackingDays(p, asOf))),
    baseline: capLog(p) - Math.log(p.tvl_usd) - flat,
  }));
  const miss = (key: 'model' | 'baseline') => Math.exp(quantile(errors.map(e => Math.abs(e[key])), 0.5));
  const inside = (factor: number) => errors.filter(e => Math.abs(e.model) <= Math.log(factor)).length / errors.length;
  const p80 = Math.exp(quantile(errors.map(e => Math.abs(e.model)), 0.8));
  return {
    train_n: train.length, test_n: test.length,
    cutoff_date: train.at(-1)!.listed_at,
    model_miss: miss('model'), baseline_miss: miss('baseline'),
    model_beats_baseline: errors.filter(e => Math.abs(e.model) < Math.abs(e.baseline)).length,
    band_p80: p80, band_coverage: inside(p80),
    design: 'Oldest half of dated traded peers trains; newest half is held out. Flat baseline refits on the same training half. One snapshot date: a time-split cross-section, not a price history.',
  };
}

export function buildRadar(snapshot: Snapshot) {
  const { as_of, source, floor_usd } = snapshot;
  const watch = new Set(snapshot.watchlist);
  const protocols = [...snapshot.protocols].sort((a, b) => lexical(a.slug, b.slug));
  const classified = protocols.map(p => ({ p, status: classify(p, watch) }));
  const live = protocols.filter(recorded);
  const rawPeers = live.filter(p => (p.mcap_usd ?? 0) > 0 && !product.test(p.category ?? '') && !wrapped.test(p.name) && !exchange.test(p.name));
  const ids = new Set<string>();
  const peers = [...rawPeers].sort((a, b) => b.tvl_usd - a.tvl_usd || lexical(a.slug, b.slug)).filter(p => {
    const id = p.gecko_id ? `gecko:${p.gecko_id}` : p.symbol ? `symbol:${p.symbol.toUpperCase()}` : p.slug;
    if (ids.has(id)) return false;
    ids.add(id);
    return true;
  }).sort((a, b) => lexical(a.slug, b.slug));
  if (peers.length < 5) throw new Error('Need at least five independent token records with market caps.');
  const fit = fitCurve(peers);
  const simpleFit = fitCurve(peers, false);
  const premiums = categoryPremiums(peers, fit);
  const odds_cohort = cohortOdds(protocols, as_of);
  // Farm economics prices the conditional slice (value if it launches); the
  // cohort odds enter once, in expected = odds × slice. The board's implied
  // value multiplies odds in, so odds are never double-counted.
  const econFor = (p: Protocol, conditionalValue: number) => farmEconomics(p, { asOf: as_of, impliedValue: conditionalValue, odds: odds_cohort.oddsFor(trackingDays(p, as_of)) });
  // Validate plans for every source record, including excluded products.
  const sourcePlans = new Map(protocols.map(p => [p.slug, farmPlan(p, trackingDays(p, as_of), econFor(p, price(p, as_of, fit, premiums).value))]));
  const validation = validate(peers, as_of);
  const walk_forward = walkForward(peers, as_of);
  const limits = [Math.min(...peers.map(p => p.tvl_usd)), Math.max(...peers.map(p => p.tvl_usd))];
  const candidates = classified.filter(({ status }) => status === 'Watchlist' || status === 'Discovery');
  const rows = candidates.map(({ p, status }) => {
    const factors = price(p, as_of, fit, premiums);
    const launch_odds = odds_cohort.oddsFor(factors.age_days);
    // implied value = value if it launches × launch odds (odds-weighted).
    const implied = clamp(Math.round(factors.value * launch_odds), 1, MAX_VALUE);
    const distance = (peer: Protocol) => Math.abs(scale(p) - scale(peer)) + (p.category && p.category === peer.category ? 0 : 1.1) + (peer.chains.some(chain => p.chains.includes(chain)) ? 0 : 0.35);
    const comparables = [...peers].sort((a, b) => distance(a) - distance(b) || lexical(a.slug, b.slug)).slice(0, 3).map(peer => peer.slug);
    const plan = sourcePlans.get(p.slug)!;
    return {
      ...p, cohort: status, age_days: factors.age_days, implied_value_usd: implied,
      conditional_value_usd: factors.value, launch_odds, verdict: plan.verdict,
      category_premium: premiumFor(premiums, p.category),
      range: [Math.max(1, Math.floor(implied / validation.factor)), Math.min(MAX_VALUE, Math.ceil(implied * validation.factor))],
      extrapolated: p.tvl_usd < limits[0] || p.tvl_usd > limits[1], factors, comparables, plan,
      valuation_sensitivity: { tvl_only: clamp(Math.round(curveValue(p.tvl_usd, simpleFit)), 1, MAX_VALUE),
        no_age: clamp(Math.round(factors.curve * factors.growth * factors.premium), 1, MAX_VALUE),
        no_growth: clamp(Math.round(factors.curve * factors.age * factors.premium), 1, MAX_VALUE),
        no_odds: factors.value },
      farm_steps: plan.steps.map(s => `${s.title} (${s.when}; ${s.time}; ${s.cost}): ${s.action}`),
    };
  }).sort((a, b) => b.implied_value_usd - a.implied_value_usd || lexical(a.slug, b.slug)).map((r, i) => ({ rank: i + 1, ...r }));
  if (rows.length < 100 || rows.length > 4000 || rows[0].implied_value_usd === rows.at(-1)?.implied_value_usd) {
    throw new Error(`Snapshot produced ${rows.length} candidates or no ranking variation; the board gate needs 100–4000 ranked rows.`);
  }
  const ranked = new Set(rows.map(p => p.slug));
  const review_order = [...new Set([...rows.slice(0, 10).map(p => p.slug), ...snapshot.watchlist])];
  const plan_audit = { validated_source_rows: sourcePlans.size, validated_ranked_rows: rows.length,
    reviewed_watchlist: snapshot.watchlist.length, review_order,
    records: review_order.map(slug => ({ slug, ...sourcePlans.get(slug)!.evidence, status: sourcePlans.get(slug)!.verdict })) };
  const alternate = [...rows].sort((a, b) => b.valuation_sensitivity.tvl_only - a.valuation_sensitivity.tvl_only || lexical(a.slug, b.slug));
  const rankSensitivity = rows.slice(0, 10).map(r => ({ slug: r.slug, rank: r.rank,
    tvl_only_rank: alternate.findIndex(p => p.slug === r.slug) + 1,
    tvl_only_value: r.valuation_sensitivity.tvl_only }));
  const exclusions = classified.filter(({ p }) => !ranked.has(p.slug)).map(({ p, status }) => ({ ...p, reason: status }));
  return {
    as_of, source, floor_usd, rows, peers, fit, validation: { ...validation, top_rank_sensitivity: rankSensitivity, walk_forward }, exclusions, plan_audit,
    odds_cohort: { buckets: odds_cohort.buckets, prior: odds_cohort.prior, disclosure: odds_cohort.disclosure },
    category_premiums: [...premiums.entries()].map(([category, v]) => ({ category, ...v })),
    econ_defaults: ECON_DEFAULTS,
    counts: { total: protocols.length, ranked: rows.length, watch: watch.size, covered: rows.filter(p => watch.has(p.slug)).length,
      discovery: rows.length - watch.size, below: rows.filter(p => p.tvl_usd < floor_usd).length, recorded: live.length,
      farm: rows.filter(p => p.verdict === 'FARM').length, thin: rows.filter(p => p.verdict === 'THIN').length, skip: rows.filter(p => p.verdict === 'SKIP').length },
  };
}
