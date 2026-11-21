// What-if calculator: independent USD assumptions, off by default.
const fields = [
  ['whatif', 'Enable what-if / 0=no, 1=yes', 0, 0, 1, 1],
  ['capital', 'Capital / USD', 250, 0, 1e6, 1],
  ['days', 'Hold / days', 30, 1, 365, 1],
  ['pool', 'Reward pool / USD', 0, 0, 1e12, 1],
  ['deposits', 'Eligible deposits / USD', 0, 0, 1e12, 1],
  ['prob', 'Joint odds / %', 10, 0, 100, .1],
  ['annual', 'Alt yield / %', 4, 0, 100, .1],
  ['fixed', 'Fixed fees / USD', 2, 0, 1e4, .01],
  ['bps', 'Friction / bps', 35, 0, 1e4, 1],
  ['weekly', 'Weekly fees / USD', 0, 0, 1e4, .01],
];
const defaults = Object.fromEntries(fields.map(([k, , v]) => [k, v]));
function economics(row, s, mult = 1) {
  if (s.whatif !== 1 || s.capital <= 0 || s.deposits <= 0) return null;
  if (fields.some(([k, , , min, max]) => !Number.isFinite(s[k]) || s[k] < min || s[k] > max) || !Number.isFinite(mult) || mult < 0) return null;
  const friction = s.capital * s.bps / 1e4, recurring = s.weekly * Math.ceil(s.days / 7);
  const opportunity = s.capital * s.annual / 100 * s.days / 365;
  const cost = s.fixed + friction + recurring + opportunity;
  const share = Math.min(1, s.capital / s.deposits), pool = s.pool * mult;
  const conditional = pool * share, expected = conditional * s.prob / 100;
  return { fixed: s.fixed, friction, recurring, opportunity, cost, share, pool, conditional, expected,
    hypothetical: row.plan.research, expectedNet: expected - cost, conditionalNet: conditional - cost,
    breakEven: conditional > 0 ? 100 * cost / conditional : cost === 0 ? 0 : null,
    verdict: expected >= cost ? 'Covers assumed costs' : 'Below assumed cost' };
}
const api = { fields, defaults, economics };
if (typeof module === 'object' && module.exports) module.exports = api;
else globalThis.FarmScenario = api;
