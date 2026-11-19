import type { Protocol } from './model.ts';
import { farmEconomics, routeFor, ECON_DEFAULTS, ODDS_PRIOR } from './economics.ts';
import type { FarmEconomics } from './economics.ts';

// Per-slug cautions that survive any economic verdict. They flag identity or
// infrastructure questions the sealed snapshot cannot answer.
const questions: Record<string, string> = {
  'bittensor-dtao': 'The snapshot labels this Dexs on Bittensor; verify ordinary pool entry and exit concepts apply at all before any deposit.',
  'lightning-network': 'Payments on Bitcoin here means node and channel infrastructure; the model cannot budget it as a bounded deposit.',
  usdd: 'The snapshot name is USDD in CDP; verify asset identity separately from the missing token record and do not infer a future issuance.',
  'reti-pooling': 'The watchlist includes this Staking Pool on Algorand; check stake-asset and token identity independently of watchlist membership.',
  saturn: 'The watchlist includes this Stablecoin Wrapper; verify underlying and receipt-token identity before reading the missing token record.',
};

// Money and percentage formatting, deterministic en-US, always 2dp for money.
const usd = (x: number) => `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

export function validatePlan(slug: string, steps: string[]) {
  if (steps.length < 3 || steps.length > 12 || steps.some(step => typeof step !== 'string' || step.trim().length < 20 || step.trim().length > 600)) {
    throw new Error(`Farm plan is outside the gate bounds: ${slug}`);
  }
}

// Weekly maintenance hypothesis per sector: a small, reversible qualifying
// action, not a verified campaign requirement.
const maintenance: Record<string, string> = {
  'Risk Curators': 're-check the curated vault caps and keep the supply position active',
  'Onchain Capital Allocator': 'confirm the allocator share price and keep the vault position active',
  Lending: 'check utilization and keep the supply position active',
  Dexs: 'check the pool range and fees; rebalance only inside the test size',
  CDP: 'check the collateral ratio without minting new debt',
  'CDP Manager': 'check the managed collateral ratio and permissions',
  RWA: 'check the subscription statement and redemption window',
  Yield: 'check the yield source and share price',
  'Yield Aggregator': 'check the strategy allocation and share price',
  'Basis Trading': 'reconcile the hedge and collateral with the custodian statement',
  'Prediction Market': 'check collateral recovery on resolved markets; open no directional bet',
  Restaking: 'check operator status and unbonding queue',
  Payments: 'run one small documented payment or liquidity action',
  Insurance: 'check cover status and exclusions',
  CeDeFi: 'reconcile the custodian statement with the onchain balance',
  'Governance Incentives': 'cast or refresh one documented vote or delegation',
  'Staking Pool': 'check validator status and reward accrual',
  'Collateral Markets': 'check collateral status and withdrawal epochs',
  'Stablecoin Wrapper': 'check backing and redemption accounting',
};
const maintenanceFor = (category: string | null) => maintenance[category ?? ''] ?? 'run one small documented qualifying action and record the receipt';

function farmSteps(p: Protocol, e: FarmEconomics, age: number | null) {
  const route = routeFor(p.category);
  const caution = questions[p.slug] ? ` ${questions[p.slug]}` : '';
  const kyc = e.needsKYC ? ' Expect an identity check before depositing; skip if it exceeds the hold.' : '';
  const entryGas = round2(route.entryTxs * e.chainFee);
  const exitGas = round2(route.exitTxs * e.chainFee);
  const weeklyGas = round2(route.weeklyTxs * e.chainFee);
  const ageNote = age === null ? 'Tracking date unreported; odds use the disclosed 0.25 prior.' : `${Math.round(age)} tracking days place it in the ${pct(e.odds)} launch-odds cohort.`;
  return [
    { title: 'Open the test position', when: 'Day 0', time: `${route.entryMin} min`, cost: `${usd(entryGas)} assumed gas`,
      action: `${p.name} (${p.slug}): deposit ${usd(e.deposit)} — sized to the ${usd(e.capital)} budget and never above 2% of its ${usd(p.tvl_usd)} snapshot TVL. Route hypothesis for sector ${p.category ?? 'unreported'} on ${e.chain}; verify the contract and asset on the official site first.${kyc}${caution}` },
    { title: 'Verify eligibility', when: 'Day 0', time: '15 min', cost: '$0 read-only',
      action: `Verify eligibility for ${p.slug} in dated official terms: qualifying action, asset, participant restrictions and cutoff. This is a sector hypothesis from the snapshot, not a verified campaign; if the terms contradict it, stop and keep the position at the test size. ${ageNote}` },
    { title: 'Budget the round trip', when: 'Before entry', time: '10 min', cost: `${usd(e.totalCost)} modeled fees`,
      action: `Assumed costs, not quotes: ${e.gasTxs} transactions × ${usd(e.chainFee)} on ${e.chain} = ${usd(e.fees.gas)} gas${e.needsBridge ? `, plus ${usd(e.fees.bridge)} bridge` : ''}, plus ${usd(e.fees.slippage)} slippage at ${e.bps} bps on ${usd(e.deposit)}; total ${usd(e.totalCost)}. Alternative yield give-up over ${e.days} days: ${usd(e.incomeForgone)} at ${pct(e.altYield)}. Skip if real quotes exceed these assumptions.` },
    { title: 'Weekly maintenance', when: `Weeks 1-${e.weeks}`, time: `${route.weeklyMin} min weekly`, cost: `${usd(weeklyGas)} per week`,
      action: `Once a week ${maintenanceFor(p.category)} on ${p.name}, so the wallet shows ${e.weeks} separate active weeks rather than one deposit. Maintenance over the hold: ${usd(round2(weeklyGas * e.weeks))} across ${route.weeklyTxs * e.weeks} transactions, about ${route.weeklyMin} min weekly.` },
    { title: 'Hold the stop rule', when: 'Weekly check', time: '5 min weekly', cost: '$0 read-only',
      action: `For ${p.slug}: withdraw if TVL falls under ${usd(e.stopTvl)} (stop level) or withdrawals pause. ${p.change_7d === null ? 'Weekly change is unreported, so a flat 10% stop applies.' : `The stop is twice its ${p.change_7d}% weekly swing, floored at 10%.`} Also exit if terms or asset identity change; do not average down.` },
    { title: 'Review and exit', when: e.reviewDate, time: `${route.exitMin} min plus settlement`, cost: `${usd(exitGas)} assumed gas`,
      action: `On ${e.reviewDate} (or at the stop level, whichever comes first) withdraw the ${usd(e.deposit)} from ${p.name}; redemptions can settle in days, so start early. Quote the full exit back to the deposit asset${e.needsBridge ? ' through the verified bridge' : ''}. If a token is announced, claim only via the official domain bookmarked on day 0 — never a link sent to you.` },
    { title: 'The modeled arithmetic', when: 'Summary', time: `${e.minutes} min total hands-on`, cost: `${usd(e.totalCost)} fees + ${usd(e.incomeForgone)} yield give-up`,
      action: `${p.name}: ${pct(e.odds)} cohort odds × ${usd(e.sliceIfLaunch)} slice if it launches = ${usd(e.expected)} expected, minus ${usd(e.totalCost)} fees = net ${e.net >= 0 ? '+' : ''}${usd(e.net)} over ${e.days} days (${usd(e.netAfterYield)} after yield give-up)${e.netPerHour !== null ? `, about ${usd(e.netPerHour)}/hour` : ''}. Verdict ${e.verdict}${e.breakEvenOdds !== null ? `; break-even at ${pct(e.breakEvenOdds)} odds` : ''}. A model figure, not a promise.` },
  ];
}

function skipSteps(p: Protocol, e: FarmEconomics, age: number | null) {
  const caution = questions[p.slug] ?? 'Until the economics or terms change, keep this record research-only: skip any signature or deposit.';
  const reason = e.skipReason === 'fees eat the drop' ? 'the modeled fees exceed the expected drop' :
    e.skipReason === 'infra unbounded' ? 'the route needs infrastructure the model cannot budget or close' :
    e.skipReason === 'no deposit route' ? 'a chain label alone provides no deposit route' :
    'the route minimum ticket exceeds the sized budget';
  const ageNote = age === null ? 'Tracking date unreported; odds use the disclosed 0.25 prior.' : `${Math.round(age)} tracking days place it in the ${pct(e.odds)} launch-odds cohort.`;
  return [
    { title: 'Read the record', when: 'Day 0', time: '10 min', cost: '$0 read-only',
      action: `${p.name} (${p.slug}): sector ${p.category ?? 'unreported'}, ${usd(p.tvl_usd)} snapshot TVL on ${e.chain}. The model sizes a ${usd(e.deposit)} test position, but the economics say skip: ${reason}.` },
    { title: 'Why the arithmetic fails', when: 'Day 0', time: '10 min', cost: '$0 read-only',
      action: `For ${p.slug} over ${e.days} days: ${e.gasTxs} assumed transactions × ${usd(e.chainFee)} on ${e.chain} = ${usd(e.fees.gas)} gas${e.needsBridge ? ` + ${usd(e.fees.bridge)} bridge` : ''} + ${usd(e.fees.slippage)} slippage = ${usd(e.totalCost)} fees, plus ${usd(e.incomeForgone)} yield give-up, against ${usd(e.expected)} expected (${pct(e.odds)} odds × ${usd(e.sliceIfLaunch)} slice). Net ${e.net >= 0 ? '+' : ''}${usd(e.net)}. ${ageNote}` },
    { title: 'Verify eligibility anyway', when: 'Research only', time: '15 min', cost: '$0 read-only',
      action: `If ${p.slug} is ever revisited, find dated official terms naming the contract, action, asset, restrictions and cutoff. ${caution}` },
    { title: 'What would change the verdict', when: 'Research only', time: '10 min', cost: '$0 read-only',
      action: `Reopen ${p.name} only if official terms name a qualifying action with lower friction or a larger reward share, or a bigger position still fits under 2% of TVL (${usd(round2(p.tvl_usd * 0.02))}). Skip again while the minimum ticket is ${usd(e.minTicket)} and the budget is ${usd(e.capital)}.` },
    { title: 'Keep the exit proof', when: 'Before any future entry', time: '10 min', cost: '$0 read-only',
      action: `Before any future entry on ${p.slug}, quote the full round trip on ${e.chain}: entry, exit, approvals and settlement delay, with a stop at ${usd(e.stopTvl)} TVL. Withdraw if TVL falls under that stop level or withdrawals pause; skip if the exit quote cannot establish when all capital returns.` },
  ];
}

// econ is the precomputed farmEconomics result. Without one, the plan degrades
// to a disclosed research-only skip (zero implied value), never a claim.
export function farmPlan(p: Protocol, age: number | null, econ?: FarmEconomics) {
  const e = econ ?? farmEconomics(p, { asOf: '2026-11-14', impliedValue: 0, odds: ODDS_PRIOR, ...ECON_DEFAULTS });
  const route = routeFor(p.category);
  const steps = e.verdict === 'SKIP' ? skipSteps(p, e, age) : farmSteps(p, e, age);
  const farm_steps = steps.map(s => `${s.title} (${s.when}; ${s.time}; ${s.cost}): ${s.action}`);
  validatePlan(p.slug, farm_steps);
  const research = e.verdict === 'SKIP';
  const oneTimeFees = round2((route.entryTxs + route.exitTxs) * e.chainFee + e.fees.bridge);
  const title = research
    ? (e.skipReason === 'fees eat the drop' ? 'Skip · fees exceed modeled drop'
      : e.skipReason === 'infra unbounded' ? 'Skip · infrastructure cost unbounded'
      : e.skipReason === 'no deposit route' ? 'Skip · no deposit route'
      : 'Skip · minimum ticket exceeds budget')
    : `${e.verdict === 'FARM' ? 'Farm' : 'Thin'} · net ${e.net >= 0 ? '+' : ''}${usd(e.net)} over ${e.days} days`;
  return {
    title, chain: e.chain, research, fixed: oneTimeFees, bps: e.bps,
    evidence: {
      basis: 'Sealed snapshot; disclosed fee, slippage and yield assumptions',
      deployment: research ? 'unknown' : 'sector hypothesis, unverified',
      asset: research ? 'unknown' : 'deposit asset per official terms',
      eligibility: research ? 'unknown' : 'unverified official terms',
      exit: research ? 'unknown' : `quoted route hypothesis, stop ${usd(e.stopTvl)}`,
    },
    econ: e, verdict: e.verdict, steps,
  };
}
