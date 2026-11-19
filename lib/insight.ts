import type { Protocol } from './model.ts';

// Row-specific observations derived only from the sealed snapshot. Each row
// gets facts that are true of it alone: its week against the market's median
// week, its size rank among the no-token field, its tracking age against the
// cohort that already launched, and where its TVL actually sits. No template
// sentence here is reusable across rows without changing its numbers.

export interface InsightContext {
  median: number;
  rankedTvls: number[]; // sorted ascending TVLs of the ranked no-token field
  cohortRateFor: (ageDays: number | null) => number;
  asOf: string;
}

const DAY = 86_400_000;
const pct1 = (x: number) => `${x > 0 ? '+' : ''}${x.toFixed(1)}%`;
const usd0 = (x: number) => `$${Math.round(x).toLocaleString('en-US')}`;

export function insightFor(p: Protocol, ageDays: number | null, ctx: InsightContext): string {
  const parts: string[] = [];
  // 1. The week, read against the market rather than against zero.
  if (p.change_7d === null) {
    parts.push(`No weekly change is recorded for ${p.slug}; the model reads its week as the market's own ${pct1(ctx.median)}.`);
  } else {
    const rel = p.change_7d - ctx.median;
    const dir = rel >= 0 ? 'outpaced' : 'lagged';
    parts.push(`Its ${pct1(p.change_7d)} week ${dir} the market's ${pct1(ctx.median)} median by ${Math.abs(rel).toFixed(1)} points${Math.abs(rel) >= 10 ? ', a wide gap worth checking for one-off flows' : ''}.`);
  }
  // 2. Size position inside the ranked no-token field.
  const n = ctx.rankedTvls.length;
  if (n > 1) {
    let below = 0;
    for (const t of ctx.rankedTvls) { if (t < p.tvl_usd) below++; else break; }
    const percentile = Math.round(100 * below / (n - 1));
    const band = percentile >= 90 ? 'one of the largest no-token pools here' :
      percentile >= 60 ? 'above most of the no-token field' :
      percentile >= 25 ? 'mid-sized among the no-token field' :
      'small next to most ranked protocols';
    parts.push(`At ${usd0(p.tvl_usd)} TVL it is ${band} (p${percentile} of ${n}); a ${usd0(Math.min(1000, p.tvl_usd * 0.02))} test position is ${(100 * Math.min(1000, p.tvl_usd * 0.02) / p.tvl_usd).toFixed(2)}% of the pool.`);
  }
  // 3. Tracking age against the cohort base rate.
  const rate = ctx.cohortRateFor(ageDays);
  if (ageDays === null) {
    parts.push('No tracking date is recorded, so the disclosed 25% prior applies instead of a cohort rate.');
  } else {
    const years = ageDays / 365;
    const ageText = years >= 2 ? `${years.toFixed(1)} years` : `${Math.round(ageDays)} days`;
    parts.push(`Tracked ${ageText} without a recorded token; ${Math.round(rate * 100)}% of protocols at this tracking age now record one.`);
  }
  // 4. Where the TVL sits: chain spread and the cheapest recorded route.
  if (p.chains.length > 1) {
    parts.push(`TVL spans ${p.chains.length} recorded chains (${p.chains.slice(0, 3).join(', ')}${p.chains.length > 3 ? ', …' : ''}); the plan routes on the cheapest, and a recorded chain is not a verified deployment.`);
  } else if (p.chains.length === 1) {
    parts.push(`All recorded TVL sits on ${p.chains[0]}, so the route has no bridge leg to budget.`);
  }
  return parts.join(' ');
}
