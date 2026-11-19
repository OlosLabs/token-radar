import type { Protocol } from './model.ts';

// ---------------------------------------------------------------------------
// Economic farm-plan engine. Pure and deterministic: every figure derives from
// the sealed snapshot plus the disclosed assumptions below. Nothing here is an
// observation of a live deployment, a campaign or a reward. Gas, bridge and
// slippage figures are ASSUMPTIONS used to cost a hypothetical route, not quotes.
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const round6 = (x: number) => Math.round((x + Number.EPSILON) * 1e6) / 1e6;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

// Assumed per-transaction gas in USD by chain name. These are planning
// assumptions, not measured fees. Unknown chains fall back to DEFAULT_CHAIN_FEE.
export const DEFAULT_CHAIN_FEE = 0.5;
export const CHAIN_FEES: Record<string, number> = {
  Solana: 0.01,
  Ethereum: 4.0,
  Base: 0.05,
  Arbitrum: 0.05,
  'Arbitrum Nova': 0.05,
  Optimism: 0.05,
  Scroll: 0.05,
  Linea: 0.05,
  BSC: 0.15,
  Binance: 0.15, // snapshot label for BNB Smart Chain
  Polygon: 0.03,
  'Polygon zkEVM': 0.05,
  Avalanche: 0.3,
  Stellar: 0.001,
  Algorand: 0.002,
  Bitcoin: 1.5,
  Tron: 0.5,
  Plume: 0.05,
  'Plume Mainnet': 0.05,
  xDai: 0.05,
};
// Assumed one-time bridge cost in USD when a route needs bridging.
export const BRIDGE_COST = 1.0;

export interface Route {
  entryTxs: number;
  exitTxs: number;
  weeklyTxs: number;
  bps: number;
  minTicket: number;
  needsBridge: boolean;
  needsKYC: boolean;
  infraSkip: boolean;
  entryMin: number;
  exitMin: number;
  weeklyMin: number;
}

// Per-category route assumptions. Transaction counts, slippage, minimum tickets
// and hands-on minutes are planning assumptions for a reversible test position,
// not verified deployment terms. infraSkip marks routes with no budgetable
// deposit path (a chain label, or node/channel infrastructure).
export const ROUTES: Record<string, Route> = {
  'Risk Curators': { entryTxs: 2, exitTxs: 2, weeklyTxs: 1, bps: 5, minTicket: 100, needsBridge: false, needsKYC: false, infraSkip: false, entryMin: 15, exitMin: 10, weeklyMin: 5 },
  'Onchain Capital Allocator': { entryTxs: 3, exitTxs: 2, weeklyTxs: 1, bps: 10, minTicket: 100, needsBridge: false, needsKYC: false, infraSkip: false, entryMin: 20, exitMin: 15, weeklyMin: 5 },
  Lending: { entryTxs: 2, exitTxs: 2, weeklyTxs: 1, bps: 8, minTicket: 50, needsBridge: false, needsKYC: false, infraSkip: false, entryMin: 12, exitMin: 10, weeklyMin: 5 },
  Dexs: { entryTxs: 3, exitTxs: 3, weeklyTxs: 1, bps: 30, minTicket: 50, needsBridge: false, needsKYC: false, infraSkip: false, entryMin: 20, exitMin: 20, weeklyMin: 8 },
  CDP: { entryTxs: 3, exitTxs: 3, weeklyTxs: 1, bps: 20, minTicket: 200, needsBridge: false, needsKYC: false, infraSkip: false, entryMin: 25, exitMin: 20, weeklyMin: 8 },
  'CDP Manager': { entryTxs: 3, exitTxs: 3, weeklyTxs: 1, bps: 25, minTicket: 500, needsBridge: false, needsKYC: false, infraSkip: false, entryMin: 25, exitMin: 25, weeklyMin: 8 },
  RWA: { entryTxs: 2, exitTxs: 2, weeklyTxs: 0, bps: 10, minTicket: 5000, needsBridge: false, needsKYC: true, infraSkip: false, entryMin: 30, exitMin: 25, weeklyMin: 0 },
  Yield: { entryTxs: 2, exitTxs: 2, weeklyTxs: 1, bps: 12, minTicket: 50, needsBridge: false, needsKYC: false, infraSkip: false, entryMin: 12, exitMin: 10, weeklyMin: 5 },
  'Yield Aggregator': { entryTxs: 2, exitTxs: 2, weeklyTxs: 1, bps: 15, minTicket: 50, needsBridge: false, needsKYC: false, infraSkip: false, entryMin: 14, exitMin: 12, weeklyMin: 5 },
  'Basis Trading': { entryTxs: 3, exitTxs: 3, weeklyTxs: 2, bps: 25, minTicket: 5000, needsBridge: true, needsKYC: true, infraSkip: false, entryMin: 30, exitMin: 30, weeklyMin: 10 },
  'Prediction Market': { entryTxs: 2, exitTxs: 2, weeklyTxs: 1, bps: 20, minTicket: 50, needsBridge: false, needsKYC: true, infraSkip: false, entryMin: 15, exitMin: 15, weeklyMin: 5 },
  Restaking: { entryTxs: 3, exitTxs: 2, weeklyTxs: 1, bps: 15, minTicket: 100, needsBridge: false, needsKYC: false, infraSkip: false, entryMin: 20, exitMin: 15, weeklyMin: 6 },
  Payments: { entryTxs: 2, exitTxs: 2, weeklyTxs: 1, bps: 10, minTicket: 50, needsBridge: false, needsKYC: false, infraSkip: false, entryMin: 15, exitMin: 15, weeklyMin: 5 },
  Chain: { entryTxs: 0, exitTxs: 0, weeklyTxs: 0, bps: 0, minTicket: 0, needsBridge: false, needsKYC: false, infraSkip: true, entryMin: 0, exitMin: 0, weeklyMin: 0 },
  Insurance: { entryTxs: 2, exitTxs: 1, weeklyTxs: 0, bps: 5, minTicket: 2500, needsBridge: false, needsKYC: true, infraSkip: false, entryMin: 25, exitMin: 15, weeklyMin: 0 },
  CeDeFi: { entryTxs: 2, exitTxs: 2, weeklyTxs: 1, bps: 10, minTicket: 2000, needsBridge: false, needsKYC: true, infraSkip: false, entryMin: 25, exitMin: 20, weeklyMin: 5 },
  'Governance Incentives': { entryTxs: 2, exitTxs: 2, weeklyTxs: 1, bps: 10, minTicket: 100, needsBridge: false, needsKYC: false, infraSkip: false, entryMin: 15, exitMin: 15, weeklyMin: 6 },
  'Staking Pool': { entryTxs: 2, exitTxs: 2, weeklyTxs: 1, bps: 8, minTicket: 50, needsBridge: false, needsKYC: false, infraSkip: false, entryMin: 15, exitMin: 12, weeklyMin: 5 },
  'Collateral Markets': { entryTxs: 3, exitTxs: 2, weeklyTxs: 1, bps: 15, minTicket: 100, needsBridge: false, needsKYC: false, infraSkip: false, entryMin: 20, exitMin: 15, weeklyMin: 6 },
  'Stablecoin Wrapper': { entryTxs: 2, exitTxs: 2, weeklyTxs: 0, bps: 5, minTicket: 50, needsBridge: false, needsKYC: false, infraSkip: false, entryMin: 12, exitMin: 10, weeklyMin: 0 },
  Derivatives: { entryTxs: 3, exitTxs: 3, weeklyTxs: 2, bps: 30, minTicket: 200, needsBridge: false, needsKYC: false, infraSkip: false, entryMin: 25, exitMin: 25, weeklyMin: 10 },
  'Liquidity Manager': { entryTxs: 3, exitTxs: 3, weeklyTxs: 1, bps: 25, minTicket: 100, needsBridge: false, needsKYC: false, infraSkip: false, entryMin: 22, exitMin: 22, weeklyMin: 8 },
  'Leveraged Farming': { entryTxs: 4, exitTxs: 4, weeklyTxs: 2, bps: 40, minTicket: 200, needsBridge: false, needsKYC: false, infraSkip: false, entryMin: 30, exitMin: 30, weeklyMin: 12 },
  Farm: { entryTxs: 3, exitTxs: 3, weeklyTxs: 2, bps: 30, minTicket: 50, needsBridge: false, needsKYC: false, infraSkip: false, entryMin: 22, exitMin: 22, weeklyMin: 10 },
  'Dual-Token Stablecoin': { entryTxs: 2, exitTxs: 2, weeklyTxs: 1, bps: 15, minTicket: 100, needsBridge: false, needsKYC: false, infraSkip: false, entryMin: 16, exitMin: 14, weeklyMin: 5 },
  'Crypto Card Issuer': { entryTxs: 2, exitTxs: 2, weeklyTxs: 1, bps: 10, minTicket: 500, needsBridge: false, needsKYC: true, infraSkip: false, entryMin: 20, exitMin: 18, weeklyMin: 5 },
  Indexes: { entryTxs: 2, exitTxs: 2, weeklyTxs: 1, bps: 15, minTicket: 100, needsBridge: false, needsKYC: false, infraSkip: false, entryMin: 16, exitMin: 14, weeklyMin: 5 },
  'Uncollateralized Lending': { entryTxs: 2, exitTxs: 2, weeklyTxs: 1, bps: 10, minTicket: 100, needsBridge: false, needsKYC: true, infraSkip: false, entryMin: 18, exitMin: 16, weeklyMin: 5 },
  'Interest Rate Derivatives': { entryTxs: 3, exitTxs: 3, weeklyTxs: 2, bps: 25, minTicket: 500, needsBridge: false, needsKYC: false, infraSkip: false, entryMin: 28, exitMin: 28, weeklyMin: 10 },
  'OTC Marketplace': { entryTxs: 2, exitTxs: 2, weeklyTxs: 0, bps: 20, minTicket: 1000, needsBridge: false, needsKYC: true, infraSkip: false, entryMin: 25, exitMin: 20, weeklyMin: 0 },
};
export const FALLBACK_ROUTE: Route = { entryTxs: 3, exitTxs: 3, weeklyTxs: 1, bps: 25, minTicket: 100, needsBridge: false, needsKYC: false, infraSkip: false, entryMin: 20, exitMin: 20, weeklyMin: 6 };

export const routeFor = (category: string | null): Route => ROUTES[category ?? ''] ?? FALLBACK_ROUTE;

// Disclosed default scenario for the economic engine (assumptions, not advice).
export const ECON_DEFAULTS = { capital: 1000, days: 84, airdropShare: 0.10, altYield: 0.04 };

// Cheapest recorded chain by assumed gas; ties break lexically for determinism.
export function cheapestChain(chains: string[]): { name: string; fee: number } {
  let best: { name: string; fee: number } | null = null;
  for (const name of [...chains].sort()) {
    const fee = CHAIN_FEES[name] ?? DEFAULT_CHAIN_FEE;
    if (best === null || fee < best.fee) best = { name, fee };
  }
  return best ?? { name: 'Unreported chain', fee: DEFAULT_CHAIN_FEE };
}

// ---------------------------------------------------------------------------
// Cohort launch odds. Empirical curve from the SEALED snapshot only: among
// protocols with a tracking date, the fraction that now has a recorded token
// (gecko_id, symbol or positive market cap), bucketed by tracking age. Rates
// are made monotone non-decreasing with a weighted pool-adjacent-violators
// smoother, then clamped to [0.05, 0.9]. A missing tracking date uses the
// disclosed conservative prior. This mirrors top competitors' cohort odds and
// is a historical base rate, not a prediction for any single protocol.
// ---------------------------------------------------------------------------

export const ODDS_PRIOR = 0.25;
const ODDS_LO = 0.05;
const ODDS_HI = 0.9;
const BUCKETS = [
  { label: '<180d', lo: 0, hi: 180, center: 90 },
  { label: '180-365d', lo: 180, hi: 365, center: 272 },
  { label: '1-2y', lo: 365, hi: 730, center: 547 },
  { label: '2-4y', lo: 730, hi: 1460, center: 1095 },
  { label: '>4y', lo: 1460, hi: Infinity, center: 2190 },
];

const hasToken = (p: Protocol) => p.gecko_id !== null || p.symbol !== null || (p.mcap_usd ?? 0) > 0;

// Weighted isotonic (non-decreasing) regression via pool-adjacent-violators.
function pava(rates: number[], weights: number[]): number[] {
  const blocks: { sum: number; weight: number; members: number[] }[] = [];
  for (let i = 0; i < rates.length; i++) {
    blocks.push({ sum: rates[i] * weights[i], weight: weights[i], members: [i] });
    while (blocks.length > 1) {
      const a = blocks[blocks.length - 2], b = blocks[blocks.length - 1];
      const ma = a.weight > 0 ? a.sum / a.weight : -Infinity;
      const mb = b.weight > 0 ? b.sum / b.weight : Infinity;
      if (ma <= mb) break;
      const merged = { sum: a.sum + b.sum, weight: a.weight + b.weight, members: [...a.members, ...b.members] };
      blocks.splice(blocks.length - 2, 2, merged);
    }
  }
  const out = new Array<number>(rates.length).fill(ODDS_PRIOR);
  for (const block of blocks) {
    const mean = block.weight > 0 ? block.sum / block.weight : ODDS_PRIOR;
    for (const i of block.members) out[i] = mean;
  }
  return out;
}

export interface CohortBucket { label: string; lo: number; hi: number; n: number; launched: number; rate: number; raw_rate: number }
export interface CohortOdds {
  buckets: CohortBucket[];
  prior: number;
  disclosure: string;
  oddsFor: (ageDays: number | null) => number;
}

export function cohortOdds(protocols: Protocol[], asOf: string): CohortOdds {
  const asOfMs = Date.parse(asOf);
  const counts = BUCKETS.map(() => ({ n: 0, launched: 0 }));
  for (const p of protocols) {
    if (p.listed_at === null) continue;
    const age = (asOfMs - Date.parse(p.listed_at)) / DAY;
    const bi = BUCKETS.findIndex(b => age >= b.lo && age < b.hi);
    if (bi < 0) continue;
    counts[bi].n += 1;
    if (hasToken(p)) counts[bi].launched += 1;
  }
  const raw = counts.map(c => (c.n > 0 ? c.launched / c.n : ODDS_PRIOR));
  const smoothed = pava(raw, counts.map(c => c.n));
  const buckets: CohortBucket[] = BUCKETS.map((b, i) => ({
    label: b.label, lo: b.lo, hi: b.hi === Infinity ? -1 : b.hi,
    n: counts[i].n, launched: counts[i].launched,
    rate: round6(clamp(smoothed[i], ODDS_LO, ODDS_HI)),
    raw_rate: round6(raw[i]),
  }));
  const centers = BUCKETS.map(b => b.center);
  const rates = buckets.map(b => b.rate);
  const oddsFor = (ageDays: number | null): number => {
    if (ageDays === null || !Number.isFinite(ageDays)) return clamp(ODDS_PRIOR, ODDS_LO, ODDS_HI);
    const age = Math.max(0, ageDays);
    if (age <= centers[0]) return rates[0];
    if (age >= centers[centers.length - 1]) return rates[rates.length - 1];
    let i = 0;
    while (i < centers.length - 1 && age > centers[i + 1]) i++;
    const t = (age - centers[i]) / (centers[i + 1] - centers[i]);
    return round6(clamp(rates[i] + t * (rates[i + 1] - rates[i]), ODDS_LO, ODDS_HI));
  };
  return {
    buckets, prior: ODDS_PRIOR, oddsFor,
    disclosure: 'Empirical launch base rate from the sealed snapshot: among protocols with a tracking date, the fraction with a recorded token (gecko_id, symbol or positive market cap), bucketed by tracking age and smoothed monotone non-decreasing (weighted pool-adjacent-violators), clamped to [0.05, 0.9]. Missing tracking date uses the disclosed conservative prior 0.25. A historical cohort base rate, not a prediction for any protocol.',
  };
}

// ---------------------------------------------------------------------------
// Per-protocol farm economics.
// ---------------------------------------------------------------------------

export interface EconContext {
  asOf: string;
  impliedValue: number;
  capital?: number;
  days?: number;
  airdropShare?: number;
  altYield?: number;
  odds: number;
}

export interface FarmEconomics {
  category: string | null;
  chain: string;
  chainFee: number;
  capital: number;
  days: number;
  weeks: number;
  airdropShare: number;
  altYield: number;
  odds: number;
  deposit: number;
  minTicket: number;
  bps: number;
  needsBridge: boolean;
  needsKYC: boolean;
  infraSkip: boolean;
  gasTxs: number;
  fixedTxs: number;
  weeklyTxs: number;
  weeklyMinutes: number;
  fees: { gas: number; bridge: number; slippage: number };
  totalCost: number;
  incomeForgone: number;
  sliceIfLaunch: number;
  expected: number;
  net: number;
  netAfterYield: number;
  breakEvenOdds: number | null;
  minutes: number;
  netPerHour: number | null;
  stopTvl: number;
  reviewDate: string;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  skipReason: string | null;
  holdBlocks: number;
}

export function farmEconomics(p: Protocol, ctx: EconContext): FarmEconomics {
  const capital = ctx.capital ?? ECON_DEFAULTS.capital;
  const days = ctx.days ?? ECON_DEFAULTS.days;
  const airdropShare = ctx.airdropShare ?? ECON_DEFAULTS.airdropShare;
  const altYield = ctx.altYield ?? ECON_DEFAULTS.altYield;
  const odds = clamp(ctx.odds, ODDS_LO, ODDS_HI);
  const route = routeFor(p.category);
  // lightning-network is Payments but needs node/channel infrastructure: no
  // budgetable deposit route, so it is skipped like a chain label.
  const infraSkip = route.infraSkip || p.slug === 'lightning-network';
  const { name: chain, fee: chainFee } = cheapestChain(p.chains);
  const weeks = Math.ceil(days / 7);

  // Deposit sized to capital, never above 2% of TVL; small-TVL protocols get a
  // proportionally smaller ticket. Floored to cents so the 2% cap always holds.
  // A ticket below the route minimum is a skip.
  const deposit = Math.floor(Math.min(capital, p.tvl_usd * 0.02) * 100) / 100;
  const gasTxs = route.entryTxs + route.exitTxs + route.weeklyTxs * weeks;
  const gas = round2(gasTxs * chainFee);
  const bridge = route.needsBridge ? BRIDGE_COST : 0;
  const slippage = round2(deposit * route.bps / 1e4);
  // Out-of-pocket transaction cost (the "fees" the modeled drop must cover).
  const totalCost = round2(gas + bridge + slippage);
  const incomeForgone = round2(deposit * altYield * days / 365);
  const sliceIfLaunch = round2(airdropShare * ctx.impliedValue * deposit / p.tvl_usd);
  const expected = round2(odds * sliceIfLaunch);
  const net = round2(expected - totalCost);
  const netAfterYield = round2(net - incomeForgone);
  const breakEvenOdds = sliceIfLaunch > 0 ? round6(totalCost / sliceIfLaunch) : null;
  const minutes = route.entryMin + route.exitMin + route.weeklyMin * weeks;
  const netPerHour = minutes > 0 ? round2(net / (minutes / 60)) : null;
  const change = p.change_7d === null ? 0 : Math.abs(p.change_7d);
  const stopFactor = p.change_7d === null ? 0.10 : Math.max(0.10, 2 * change / 100);
  const stopTvl = round2(Math.max(0, p.tvl_usd * (1 - stopFactor)));
  const reviewDate = new Date(Date.parse(ctx.asOf) + days * DAY).toISOString().slice(0, 10);

  let verdict: 'FARM' | 'THIN' | 'SKIP';
  let skipReason: string | null = null;
  if (infraSkip) {
    verdict = 'SKIP';
    skipReason = p.category === 'Chain' ? 'no deposit route' : 'infra unbounded';
  } else if (deposit < route.minTicket) {
    verdict = 'SKIP';
    skipReason = 'min ticket exceeds budget';
  } else if (net <= 0) {
    verdict = 'SKIP';
    skipReason = 'fees eat the drop';
  } else if (netAfterYield > 0 && breakEvenOdds !== null && breakEvenOdds < odds * 0.8) {
    // FARM clears both hurdles: out-of-pocket fees and the T-bill yield the
    // capital gives up. THIN clears fees only.
    verdict = 'FARM';
  } else {
    verdict = 'THIN';
  }
  // Block budgeting: one hold is a 12-week block. At the cohort's annual base
  // rate, roughly 1/odds years of waiting is expected; budget that many blocks
  // (capped at 6) and renew only while the arithmetic still pays. Disclosed
  // planning assumption, not an observed launch schedule.
  const holdBlocks = Math.min(6, Math.max(1, Math.round(1 / Math.max(odds, 0.05))));

  return {
    category: p.category, chain, chainFee, capital, days, weeks, airdropShare, altYield, odds,
    deposit, minTicket: route.minTicket, bps: route.bps, needsBridge: route.needsBridge,
    needsKYC: route.needsKYC, infraSkip, gasTxs, fixedTxs: route.entryTxs + route.exitTxs, weeklyTxs: route.weeklyTxs, weeklyMinutes: route.weeklyMin,
    fees: { gas, bridge, slippage }, totalCost, incomeForgone, sliceIfLaunch, expected, net, netAfterYield,
    breakEvenOdds, minutes, netPerHour, stopTvl, reviewDate, verdict, skipReason, holdBlocks,
  };
}
