// In-browser recompute: the same arithmetic the Node build ran, executed here
// against window.FIELD so a reader can verify every dossier number live.
// Pure functions, no network, deterministic.
(function () {
  'use strict';
  const F = window.FIELD;
  if (!F) return;
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const round2 = x => Math.round((x + Number.EPSILON) * 100) / 100;

  // Mirrors lib/model.ts price(): curve × relative momentum × seasoning ×
  // category premium, then × cohort odds for the ranked implied value.
  function priceRow(r, opts) {
    const o = opts || {};
    const tvl = o.tvl ?? r.tvl_usd;
    const change = o.change ?? r.change_7d;
    const median = F.market_median_change_7d;
    const g = clamp((change ?? median) - median, -30, 30) / 30;
    const curve = Math.exp(F.fit.intercept + F.fit.slope * Math.log(tvl / 1e8));
    const growth = Math.exp(F.fit.momentum * g);
    const seasoning = 0.82 + 0.18 * clamp((r.age_days ?? 730) / 1460, 0, 1);
    const premium = o.premium ?? r.category_premium.factor;
    const odds = o.odds ?? r.launch_odds;
    const conditional = Math.max(1, Math.round(curve * growth * seasoning * premium));
    return { curve, growth, seasoning, premium, odds, conditional, implied: Math.max(1, Math.round(conditional * odds)) };
  }

  // Mirrors lib/economics.ts farmEconomics() under a custom scenario.
  function farmRow(r, s) {
    const e = r.plan.econ;
    const capital = s.capital ?? e.capital;
    const days = s.days ?? e.days;
    const share = s.share ?? e.airdropShare;
    const alt = s.alt ?? e.altYield;
    const odds = clamp(s.odds ?? e.odds, 0.05, 0.9);
    const weeks = Math.ceil(days / 7);
    const deposit = round2(Math.min(capital, r.tvl_usd * 0.02));
    const nTxs = e.fixedTxs + e.weeklyTxs * weeks;
    const gas = round2(nTxs * e.chainFee);
    const slippage = round2(deposit * e.bps / 1e4);
    const totalCost = round2(gas + slippage + e.fees.bridge);
    const incomeForgone = round2(deposit * alt * days / 365);
    const pv = priceRow(r, { odds });
    const slice = round2(share * pv.conditional * deposit / r.tvl_usd);
    const expected = round2(odds * slice);
    const net = round2(expected - totalCost);
    const netAfterYield = round2(net - incomeForgone);
    const breakEven = slice > 0 ? totalCost / slice : null;
    const verdict = e.infraSkip || deposit < e.minTicket || net <= 0 ? 'SKIP'
      : netAfterYield > 0 && breakEven !== null && breakEven < odds * 0.8 ? 'FARM' : 'THIN';
    const minutes = r.plan.econ.minutes + (weeks - e.weeks) * (r.plan.econ.weeklyMinutes ?? 5);
    const netPerHour = minutes > 0 ? round2(net / (minutes / 60)) : null;
    return { deposit, nTxs, gas, slippage, totalCost, incomeForgone, slice, expected, net, netAfterYield, breakEven, verdict, weeks, days, odds, minutes, netPerHour };
  }

  // Verify a row: recompute and compare with the stored board values.
  function verify(r) {
    const pv = priceRow(r);
    return {
      impliedMatch: pv.implied === r.implied_value_usd,
      conditionalMatch: pv.conditional === r.conditional_value_usd,
      recomputed: pv.implied, stored: r.implied_value_usd,
    };
  }

  window.Recompute = { priceRow, farmRow, verify };
})();
