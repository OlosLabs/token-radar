(function () {
  'use strict';
  const F = window.FIELD;
  if (!F) return;
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const round2 = x => Math.round((x+Number.EPSILON)*100)/100;
  const round6 = x => Math.round((x+Number.EPSILON)*1e6)/1e6;
  function priceRow(r, o = {}) {
    const tvl = o.tvl ?? r.tvl_usd, change = o.change ?? r.change_7d, median = F.market_median_change_7d;
    const g = clamp((change ?? median) - median, -30, 30) / 30;
    const curve = Math.exp(F.fit.intercept + F.fit.slope * Math.log(tvl / 1e8));
    const growth = Math.exp(F.fit.momentum * g);
    const seasoning = 0.82 + 0.18 * clamp((r.age_days ?? 730) / 1460, 0, 1);
    const premium = 1, odds = o.odds ?? r.launch_odds;
    const conditional = clamp(Math.round(curve * growth * seasoning), 1, 1e14);
    return { curve, growth, seasoning, premium, odds, conditional, implied: clamp(Math.round(conditional * odds), 1, 1e14) };
  }
  function farmRow(r, s = {}) {
    const e = r.plan.econ;
    const capital = s.capital ?? e.capital, days = s.days ?? e.days, airdropShare = s.share ?? e.airdropShare, altYield = s.alt ?? e.altYield;
    const odds = clamp(s.odds ?? e.odds, 0.05, 0.9), weeks = Math.ceil(days / 7);
    const deposit = Math.floor(Math.min(capital, r.tvl_usd * 0.02) * 100) / 100;
    const gasTxs = e.fixedTxs + e.weeklyTxs * weeks;
    const fees = { gas: round2(gasTxs * e.chainFee), slippage: round2(deposit * e.bps / 1e4), bridge: e.fees.bridge };
    const totalCost = round2(fees.gas + fees.bridge + fees.slippage);
    const incomeForgone = round2(deposit * altYield * days / 365);
    const sliceIfLaunch = round2(airdropShare * r.conditional_value_usd * deposit / r.tvl_usd);
    const expected = round2(odds * sliceIfLaunch), net = round2(expected - totalCost);
    const netAfterYield = round2(net - incomeForgone);
    const breakEvenOdds = sliceIfLaunch > 0 ? round6(totalCost / sliceIfLaunch) : null;
    const skipReason = e.infraSkip ? (e.category === 'Chain' ? 'no deposit route' : 'infra unbounded')
      : deposit < e.minTicket ? 'min ticket exceeds budget' : net <= 0 ? 'fees eat the drop' : null;
    const verdict = skipReason ? 'SKIP' : netAfterYield > 0 && breakEvenOdds !== null && breakEvenOdds < odds * 0.8 ? 'FARM' : 'THIN';
    const minutes = e.minutes + (weeks - e.weeks) * e.weeklyMinutes;
    const netPerHour = minutes > 0 ? round2(net / (minutes / 60)) : null;
    const reviewDate = new Date(Date.parse(F.as_of) + days * 86400000).toISOString().slice(0, 10);
    return { ...e, capital, days, airdropShare, altYield, deposit, gasTxs, fees, totalCost, incomeForgone, sliceIfLaunch, expected, net, netAfterYield, breakEvenOdds, verdict, skipReason, weeks, odds, minutes, netPerHour, reviewDate };
  }
  function verify(r) {
    const pv = priceRow(r);
    return { impliedMatch: pv.implied === r.implied_value_usd, conditionalMatch: pv.conditional === r.conditional_value_usd, recomputed: pv.implied, stored: r.implied_value_usd };
  }
  window.Recompute = { priceRow, farmRow, verify };
})();
