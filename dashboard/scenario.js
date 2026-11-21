// What-if calculator: pool/deposits are independent USD assumptions.
const fields = [
  ['whatif', 'Enable unverified what-if / 0=no, 1=yes', 0, 0, 1, 1],
  ['capital', 'Capital / USD', 250, 0, 1000000, 1],
  ['days', 'Hold / days', 30, 1, 365, 1],
  ['pool', 'Hypothetical eligible reward pool / USD', 0, 0, 1000000000000, 1],
  ['deposits', 'Hypothetical eligible deposits / USD', 0, 0, 1000000000000, 1],
  ['prob', 'Joint launch + eligibility odds / %', 10, 0, 100, 0.1],
  ['annual', 'Alternative yield / % annual', 4, 0, 100, 0.1],
  ['fixed', 'Assumed round-trip fixed fees / USD', 2, 0, 10000, 0.01],
  ['bps', 'Assumed round-trip friction / bps', 35, 0, 10000, 1],
  ['weekly', 'Extra weekly fees / USD', 0, 0, 10000, 0.01],
];
const defaults = Object.fromEntries(fields.map(([k, , v]) => [k, v]));
function economics(row, s, poolMultiplier = 1) {
  if (s.whatif !== 1 || s.capital <= 0 || s.deposits <= 0) return null;
  if (fields.some(([k, , , min, max]) => !Number.isFinite(s[k]) || s[k] < min || s[k] > max) || !Number.isFinite(poolMultiplier) || poolMultiplier < 0) return null;
  const friction = s.capital * s.bps / 10000, recurring = s.weekly * Math.ceil(s.days / 7);
  const opportunity = s.capital * s.annual / 100 * s.days / 365;
  const cost = s.fixed + friction + recurring + opportunity;
  // Deposits include capital. No TVL/value in payout.
  const share = Math.min(1, s.capital / s.deposits), pool = s.pool * poolMultiplier;
  const conditional = pool * share, expected = conditional * s.prob / 100;
  return { fixed: s.fixed, friction, recurring, opportunity, cost, share, pool, conditional, expected,
    hypothetical: row.plan.research, expectedNet: expected - cost, conditionalNet: conditional - cost,
    breakEven: conditional > 0 ? 100 * cost / conditional : cost === 0 ? 0 : null,
    verdict: expected >= cost ? 'Covers assumed costs' : 'Below assumed cost' };
}
const api = { fields, defaults, economics };
if (typeof module === 'object' && module.exports) module.exports = api;
else globalThis.FarmScenario = api;