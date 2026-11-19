(() => {
  'use strict';
  const data = window.FIELD;
  if (!data) return;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  const compact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 });
  const usd = value => value == null ? 'n/a' : compact.format(value);
  const cash = value => money.format(Math.abs(value) < 0.005 ? 0 : value);
  const signed = value => `${value >= 0 ? '+' : '-'}${cash(Math.abs(value))}`;
  const pct = value => value == null ? 'Unreported' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
  const oddsPct = value => `${Math.round(value * 100)}%`;
  const times = value => `${value.toFixed(2)}×`;
  const range = row => row.range.map(usd).join(' to ');
  const ledger = entries => `<dl class="ledger">${entries.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
  const badge = verdict => `<span class="badge b-${verdict}">${verdict}</span>`;
  const { fields, defaults, economics } = window.FarmScenario;
  const { rows, peers, fit, validation, counts } = data;
  const bySlug = new Map(rows.map(row => [row.slug, row]));
  const peerBySlug = new Map(peers.map(peer => [peer.slug, peer]));
  const chosen = new Set();
  const pageSize = 10;
  let page = 0, active = rows[0], scenario = { ...defaults };
  const farmRows = rows.filter(r => r.verdict === 'FARM');
  const portfolioNet = farmRows.reduce((s, r) => s + r.plan.econ.netAfterYield, 0);
  const portfolioMin = farmRows.reduce((s, r) => s + r.plan.econ.minutes, 0);
  const bestHour = rows.reduce((b, r) => (r.plan.econ.netPerHour ?? -Infinity) > (b?.plan.econ.netPerHour ?? -Infinity) ? r : b, null);
  let previousFocus;

  function renderChart() {
    const width = Math.max(265, Math.round($('chart').clientWidth));
    const height = Math.round($('chart').getBoundingClientRect().height) || 207;
    const left = 48, right = width - 15, top = 12, bottom = height - 34;
    const curve = logTvl => (fit.intercept + fit.slope * Math.log(10) * (logTvl - 8)) / Math.log(10);
    const tx = peers.map(p => Math.log10(p.tvl_usd)), ty = peers.map(p => Math.log10(p.mcap_usd));
    const endX = Math.ceil(Math.max(Math.log10(active.tvl_usd), ...tx));
    const startX = Math.floor(Math.min(...tx, Math.log10(active.tvl_usd)));
    const endY = Math.ceil(Math.max(...ty, Math.log10(active.implied_value_usd)));
    const startY = Math.floor(Math.min(...ty, Math.log10(active.implied_value_usd)));
    const x = v => left + (v - startX) * (right - left) / Math.max(1, endX - startX);
    const y = v => bottom - (v - startY) * (bottom - top) / Math.max(1, endY - startY);
    const band = Math.log10(validation.factor);
    const path = [startX, endX].map(v => `${x(v)},${y(curve(v) + band)}`).concat([endX, startX].map(v => `${x(v)},${y(curve(v) - band)}`)).join(' ');
    const sx = x(Math.log10(active.tvl_usd)), sy = y(Math.log10(active.implied_value_usd));
    let grid = '';
    for (let v = startX; v <= endX; v++) {
      grid += `<path class="chart-grid" d="M${x(v)} ${top}V${bottom}"/><text class="chart-tick" x="${x(v)}" y="${bottom + 15}" text-anchor="middle">${usd(10 ** v)}</text>`;
    }
    for (let v = startY; v <= endY; v += endY - startY > 5 ? 2 : 1) {
      grid += `<path class="chart-grid" d="M${left} ${y(v)}H${right}"/><text class="chart-tick" x="${left - 7}" y="${y(v) + 4}" text-anchor="end">${usd(10 ** v)}</text>`;
    }
    const near = new Set(active.comparables);
    $('chart').innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Market capitalization versus TVL for ${peers.length} traded peers. Selected: ${esc(active.name)}, ${usd(active.tvl_usd)} TVL and ${usd(active.implied_value_usd)} odds-weighted implied value.">
      <defs><clipPath id="plot-clip"><rect x="${left}" y="${top}" width="${right-left}" height="${bottom-top}"/></clipPath></defs>${grid}
      <g clip-path="url(#plot-clip)"><polygon class="chart-band" points="${path}"/><path class="chart-fit" d="M${x(startX)} ${y(curve(startX))}L${x(endX)} ${y(curve(endX))}"/></g>
      ${peers.map((p, i) => `<circle class="chart-point${near.has(p.slug) ? ' chart-near' : ''}" cx="${x(tx[i])}" cy="${y(ty[i])}" r="${near.has(p.slug) ? 4 : 2.9}"><title>${esc(p.name)} | ${usd(p.tvl_usd)} TVL | ${usd(p.mcap_usd)} market cap</title></circle>`).join('')}
      <path class="chart-marker" d="M${sx} ${sy - 6}l6 6 -6 6 -6 -6z"/>
      <text class="chart-tick" x="${(left + right) / 2}" y="${height - 2}" text-anchor="middle">Total value locked</text></svg>`;
    $('chart-key').textContent = `${active.name} / ${usd(active.implied_value_usd)}`;
  }

  function renderEvidence() {
    $('edition').textContent = `${data.as_of} UTC`;
    $('coverage').innerHTML = [[`${counts.covered}/${counts.watch}`, 'Watchlist covered'], [counts.farm, 'FARM verdicts'], [counts.total, 'Snapshot records']]
      .map(([value, label]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join('');
    $('farm-now').innerHTML = `<b>Farm now:</b> ${farmRows.slice().sort((a,b)=>b.plan.econ.netAfterYield-a.plan.econ.netAfterYield).slice(0,3).map(r => `${esc(r.name)} ${signed(r.plan.econ.netAfterYield)}`).join(' · ')} · all ${farmRows.length} FARM = ${signed(portfolioNet)} for ${(portfolioMin/60).toFixed(0)}h · best ${esc(bestHour.name)} ${signed(bestHour.plan.econ.netPerHour)}/h`;
    const wf = validation.walk_forward;
    $('validation-intro').textContent = `${wf.train_n} oldest tracked peers price the ${wf.test_n} newest, unseen in training. Closer to 1× is better.`;
    $('validation').innerHTML = `<div><strong class="metric">${times(wf.model_miss)}</strong><span>Walk-forward model</span></div><div><strong class="metric">${times(wf.baseline_miss)}</strong><span>Flat baseline</span></div>`;
    const cohort = data.odds_cohort;
    const premiums = data.category_premiums.filter(c => c.n >= 2).sort((a, b) => b.n - a.n || a.category.localeCompare(b.category, 'en'));
    $('methods').innerHTML = `<p><b>Formula.</b> implied value = e^(${fit.intercept.toFixed(4)} + ${fit.slope.toFixed(4)} × ln(TVL / $100M) + ${fit.momentum.toFixed(4)} × g) × seasoning × category premium × launch odds. Relative momentum g = clamp(7-day TVL change − market median week (${data.market_median_change_7d.toFixed(1)}%), −30, +30) / 30; a missing week reads as the market itself. Ridge penalties 2 and 12; slope bounded 0–1.5, growth ±0.25. The conditional value (before odds) is shown separately in every dossier.</p>
      <p><b>Launch odds.</b> ${esc(cohort.disclosure)}</p>
      <table class="sensitivity"><caption>Cohort launch odds / sealed snapshot</caption><thead><tr><th>Tracking age</th><th>n</th><th>Launched</th><th>Raw rate</th><th>Applied odds</th></tr></thead><tbody>${cohort.buckets.map(b => `<tr><th>${esc(b.label)}</th><td>${b.n}</td><td>${b.launched}</td><td>${b.n ? oddsPct(b.raw_rate) : 'n/a'}</td><td>${oddsPct(b.rate)}</td></tr>`).join('')}<tr><th>No tracking date</th><td colspan="3">Disclosed conservative prior</td><td>${oddsPct(cohort.prior)}</td></tr></tbody></table>
      <p><b>Category premium.</b> Median gap between a category's traded tokens and the curve, shrunk toward 1× by n/(n+5) and clamped to 0.5–2×. Categories without traded peers stay at 1×.</p>
      <table class="sensitivity"><caption>Category premiums (n ≥ 2)</caption><thead><tr><th>Category</th><th>Peers</th><th>Raw gap</th><th>Applied</th></tr></thead><tbody>${premiums.map(c => `<tr><th>${esc(c.category)}</th><td>${c.n}</td><td>${times(c.raw)}</td><td>${times(c.factor)}</td></tr>`).join('')}</tbody></table>
      <p><b>Seasoning.</b> Tracking factor = 0.82 + 0.18 × min(tracking days / 1,460, 1); missing dates use 730 days. The first tracking date does not establish launch history; a disclosed haircut, not a launch probability.</p>
      <p><b>Walk-forward split.</b> ${esc(wf.design)} Cutoff ${wf.cutoff_date}: the model beats the flat baseline on ${wf.model_beats_baseline}/${wf.test_n} held-out peers; ${Math.round(wf.band_coverage * 100)}% of held-out errors fall inside the ×${wf.band_p80.toFixed(2)} band.</p>
      <p><b>Same-fold audit (n=${validation.folds}).</b> TVL-only: ${times(validation.miss.tvl)}; TVL + growth: ${times(validation.miss.growth)}; TVL + age: ${times(validation.miss.age)}; full model: ${times(validation.miss.full)}. The baseline refits the median log cap/TVL ratio.</p>
      <table class="sensitivity"><caption>Identical held-out folds / observed errors</caption><thead><tr><th>Variant / n</th><th>Median miss</th><th>80% error factor</th><th>Log residual p10–p90</th></tr></thead><tbody>${Object.entries(validation.diagnostics).map(([key, d]) => `<tr><th>${key} / ${d.n}</th><td>${times(d.median_miss)}</td><td>${times(d.error_factor_p80)}</td><td>${d.residual_p10_p90.map(v => v.toFixed(2)).join(' to ')}</td></tr>`).join('')}</tbody></table>
      <p>${validation.comparisons.map(c => `${c.a} beats ${c.b} on ${c.a_lower_error}/${c.n} folds`).join('; ')}. ${esc(validation.limits)}</p>
      <p><b>Top-10 rank sensitivity, TVL-only.</b> ${validation.top_rank_sensitivity.map(r => `${esc(bySlug.get(r.slug).name)} #${r.rank} → #${r.tvl_only_rank}`).join('; ')}. No coefficients or candidates were tuned using these results.</p>
      <p><b>Range.</b> Divide and multiply by ${times(validation.factor)}, the 80th percentile absolute held-out log error exponentiated. ${Math.round(validation.coverage * 100)}% of traded errors fit a band estimated without their own residual. Cross-sectional diagnostics do not calibrate pre-token outcomes. Market cap is circulating, not FDV.</p>
      <p><b>Farm economics.</b> Every plan costs a hypothetical route with disclosed assumptions: per-chain gas, slippage, bridge and yield give-up; a ${oddsPct(data.econ_defaults.airdropShare)} airdrop share of the conditional value, pro-rated by deposit/TVL. Verdicts: FARM when net > 0 and break-even odds sit under 80% of cohort odds; THIN when positive but marginal; SKIP when fees eat the drop, a minimum ticket exceeds the sized position, or no bounded route exists. Nothing here observes a live campaign.</p>`;
  }

  function renderAudit() {
    const total = rows.reduce((sum, row) => sum + row.implied_value_usd, 0);
    const ordered = rows.every((row, i) => row.rank === i + 1 && (i === 0 || rows[i - 1].implied_value_usd >= row.implied_value_usd));
    const seal = data.snapshot_sha256.slice(0, 8);
    $('audit').innerHTML = `<span>this table = board.json</span><span>${rows.length} rows drawn = ${rows.length} written</span><span>ranks 1–${rows.length} in order${ordered ? ' ✓' : ' ✗'}</span><span>values never rise down the board${ordered ? ' ✓' : ' ✗'}</span><span>total ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(total)}</span><span>seal ${seal} = ${seal}</span><span>${counts.covered}/${counts.watch} watchlist ranked</span>`;
  }

  function setOptions(id, values) {
    const select = $(id);
    for (const value of Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'en'))) select.add(new Option(value, value));
  }
  function compareButton(row) {
    const pressed = chosen.has(row.slug);
    return `<button type="button" class="compare-toggle" data-compare="${esc(row.slug)}" aria-pressed="${pressed}" aria-label="Compare ${esc(row.name)}">${pressed ? '✓' : '+'}</button>`;
  }
  function renderBoard() {
    const q = $('search').value.trim().toLowerCase();
    const category = $('category').value, chain = $('chain').value, cohort = $('cohort').value, verdict = $('verdict').value;
    const selected = rows.map(row => ({ row, result: economics(row, scenario) })).filter(({ row }) =>
      (!q || [row.name, row.slug, row.category, ...row.chains].join(' ').toLowerCase().includes(q)) &&
      (!category || row.category === category) && (!chain || row.chains.includes(chain)) &&
      (!cohort || (cohort === 'below' ? row.tvl_usd < data.floor_usd : row.cohort === cohort)) && (!verdict || row.verdict === verdict));
    const sort = $('sort').value;
    selected.sort((a, b) => ({
      rank: () => 0, tvl: () => b.row.tvl_usd - a.row.tvl_usd,
      growth: () => (b.row.change_7d ?? -Infinity) - (a.row.change_7d ?? -Infinity),
      net: () => (b.result?.expectedNet ?? b.row.plan.econ.net) - (a.result?.expectedNet ?? a.row.plan.econ.net),
      odds: () => b.row.launch_odds - a.row.launch_odds,
      name: () => a.row.name.localeCompare(b.row.name, 'en'),
    }[sort]() || a.row.rank - b.row.rank));
    const total = selected.length;
    page = Math.min(page, Math.max(0, Math.ceil(total / pageSize) - 1));
    const start = page * pageSize;
    const shown = selected.slice(start, start + pageSize);
    $('matching').textContent = `${total} of ${rows.length} candidates`;
    $('scenario-summary').textContent = scenario.whatif ? `What-if on / ${usd(scenario.pool)} pool / ${usd(scenario.deposits)} deposits` : `Model economics on / ${usd(data.econ_defaults.capital)} position / ${data.econ_defaults.days} days`;
    $('table').innerHTML = total ? `<table class="table"><caption class="sr">Ranked launch candidates. Select a protocol to open its dossier.</caption><thead><tr><th scope="col">Rank</th><th scope="col">Protocol / sector</th><th scope="col">TVL / 7d change</th><th scope="col">Implied value / odds</th><th scope="col">Verdict / net of fees</th><th scope="col">Compare</th></tr></thead><tbody>
      ${shown.map(({ row, result }) => `<tr><td>#${row.rank}</td><td class="name"><button type="button" class="protocol" data-open="${esc(row.slug)}">${esc(row.name)}</button><small>${esc(row.category ?? 'Unclassified')} / ${esc(row.plan.chain)} / ${row.cohort}</small></td>
        <td class="tvl num"><span class="sr">TVL </span>${usd(row.tvl_usd)}<small class="${row.change_7d < 0 ? 'down' : 'up'}">${pct(row.change_7d)}</small></td>
        <td class="value num"><span class="sr">Implied value </span><strong>${usd(row.implied_value_usd)}</strong><small>${oddsPct(row.launch_odds)} odds / ${usd(row.conditional_value_usd)} if launched</small></td>
        <td class="farm">${badge(row.verdict)}<small>${signed(row.plan.econ.net)} net / ${row.plan.econ.netPerHour == null ? 'n/a' : signed(row.plan.econ.netPerHour) + '/h'} / ${cash(row.plan.econ.totalCost)} fees${result ? ` · what-if ${signed(result.expectedNet)}` : ''}</small></td><td class="select">${compareButton(row)}</td></tr>`).join('')}
      </tbody></table>` : '<p class="empty">No candidates match. Change a filter or <button type="button" data-clear>clear filters</button>.</p>';
    $('pager').hidden = !total;
    $('page-info').textContent = `${start + 1}–${Math.min(start + pageSize, total)} of ${total}`;
    $('prev').disabled = page === 0;
    $('next').disabled = start + pageSize >= total;
  }

  function renderCompare() {
    $('comparison').hidden = !chosen.size;
    $('compare-count').textContent = `${chosen.size} of 3 selected`;
    $('compare-grid').innerHTML = [...chosen].map(slug => {
      const r = bySlug.get(slug), e = economics(r, scenario), m = r.plan.econ;
      return `<article class="compare-card"><div class="heading"><h3>${esc(r.name)}</h3>${compareButton(r)}</div>
        <p class="muted">#${r.rank} / ${esc(r.plan.chain)} / ${badge(r.verdict)}</p>${ledger([['Implied value (odds-weighted)', usd(r.implied_value_usd)], ['Value if launched', usd(r.conditional_value_usd)], ['Launch odds', oddsPct(r.launch_odds)], ['Model net of fees', signed(m.net)], ['Model fees', cash(m.totalCost)], ['Break-even odds', m.breakEvenOdds == null ? 'n/a' : oddsPct(m.breakEvenOdds)], ...(e ? [['What-if expected net', signed(e.expectedNet)], ['What-if cost', cash(e.cost)]] : [])])}</article>`;
    }).join('');
  }

  function renderDetail() {
    const r = active, f = r.factors, m = r.plan.econ, e = economics(r, scenario);
    const decision = m.verdict === 'SKIP'
      ? `<p class="decision"><b>Skip this one:</b> ${esc(m.skipReason)}. ${cash(m.totalCost)} modeled fees against ${cash(m.expected)} expected at ${oddsPct(m.odds)} odds — the arithmetic does not pay at ${cash(m.deposit)}.</p>`
      : `<p class="decision"><b>${m.verdict === 'FARM' ? 'Farm it' : 'Thin — farm only if terms verify'}:</b> ${signed(m.net)} net of fees, ${signed(m.netAfterYield)} after the ${oddsPct(m.altYield)} T-bill give-up, ${m.netPerHour == null ? 'n/a' : signed(m.netPerHour)}/hour over ${(m.minutes/60).toFixed(1)} h of work. Fees are covered from ${m.breakEvenOdds == null ? 'n/a' : oddsPct(m.breakEvenOdds)} launch odds up; the model says ${oddsPct(m.odds)}. A ${oddsPct(m.altYield)} T-bill would pay ${cash(m.incomeForgone)} on ${cash(m.deposit)} over ${m.days} days${m.verdict === 'FARM' ? ', and the expected drop beats that' : '; the drop clears fees but not that hurdle'}. Renew in 12-week blocks, up to ${m.holdBlocks}.</p>`;
    const modelLedger = ledger([
      ['Sized deposit (≤2% of TVL)', cash(m.deposit)], [`Gas / ${m.gasTxs} tx on ${esc(m.chain)}`, cash(m.fees.gas)],
      ['Slippage / bridge', `${cash(m.fees.slippage)} / ${cash(m.fees.bridge)}`], ['Yield give-up (disclosed)', cash(m.incomeForgone)],
      ['Total fees', cash(m.totalCost)], ['Slice if it launches', cash(m.sliceIfLaunch)],
      ['Expected at cohort odds', `${cash(m.expected)} at ${oddsPct(m.odds)}`], ['Net of fees / after yield', `${signed(m.net)} / ${signed(m.netAfterYield)}`],
      ['Break-even launch odds', m.breakEvenOdds == null ? 'No slice modeled' : `${oddsPct(m.breakEvenOdds)}${m.breakEvenOdds > 1 ? ' (unreachable)' : ''}`],
      ['Net per hands-on hour', m.netPerHour == null ? 'n/a' : `${signed(m.netPerHour)} / ${m.minutes} min`],
      ['Stop level / review date', `${usd(m.stopTvl)} TVL / ${m.reviewDate}`],
    ]);
    const whatIf = e ? `<h3>Unverified what-if calculator</h3><p class="muted">${usd(scenario.pool)} hypothetical pool / ${usd(scenario.deposits)} assumed eligible deposits including your capital / ${scenario.prob}% assumed joint odds over ${scenario.days} days. Conditional payout = pool × min(1, capital / deposits). Independent of the model above; rewards exclude principal.</p>${ledger([
      ['One-time fees / friction', `${cash(e.fixed)} / ${cash(e.friction)}`], ['Recurring / opportunity', `${cash(e.recurring)} / ${cash(e.opportunity)}`],
      ['Total cost', cash(e.cost)], ['Conditional payout / net', `${cash(e.conditional)} / ${cash(e.conditionalNet)}`],
      ['Expected payout / net', `${cash(e.expected)} / ${cash(e.expectedNet)}`], ['Break-even joint odds', e.breakEven == null ? 'No payout modeled' : `${e.breakEven.toFixed(1)}%${e.breakEven > 100 ? ' (unreachable)' : ''}`],
    ])}<h3>Reward-pool sensitivity</h3><table class="sensitivity"><thead><tr><th>Case</th><th>Pool / USD</th><th>Conditional net</th><th>Expected net</th></tr></thead><tbody>
      ${[['Low / 0.5×', 0.5], ['Base / 1×', 1], ['High / 2×', 2]].map(([label, multiplier]) => {
        const result = economics(r, scenario, multiplier);
        return `<tr><th scope="row">${label}</th><td>${usd(result.pool)}</td><td>${cash(result.conditionalNet)}</td><td>${cash(result.expectedNet)}</td></tr>`;
      }).join('')}</tbody></table><p class="muted">Only the hypothetical reward pool changes: half/base/double. Deposits, costs, capital, hold and odds stay fixed. Valuation and snapshot TVL never enter this payout.</p>` : '';
    $('detail').innerHTML = `<header class="detail-header"><div class="heading"><div><p class="label">Protocol dossier / Rank ${r.rank} / ${r.cohort} / ${badge(r.verdict)}</p><h2 id="dossier-title">${esc(r.name)}</h2><p class="muted">${esc(r.category ?? 'Unclassified')} / ${esc(r.plan.chain)} / No recorded token</p></div><div class="detail-controls">${compareButton(r)}<button type="button" data-close autofocus>Close dossier</button></div></div>
      <div class="detail-kpis"><div><strong>${usd(r.implied_value_usd)}</strong><span>Implied value × ${oddsPct(r.launch_odds)} odds</span></div><div><strong>${usd(r.conditional_value_usd)}</strong><span>Value if it launches</span></div><div><strong>${signed(m.net)}</strong><span>Model net of fees</span></div><div><strong>${pct(r.change_7d)}</strong><span>7-day TVL change</span></div></div></header>
      <div class="detail-columns"><article>${decision}<h3>Farm plan / ${esc(r.plan.title)}</h3><p class="muted">${r.plan.research ? 'Skip verdict: the steps below cost the hypothesis and explain the economics without allocating funds.' : `${cash(m.deposit)} sized position / ${m.days} days. Disclosed assumptions, not observed terms; verify the deployment first.`}</p>
        <ol class="timeline">${r.plan.steps.map(s => `<li><strong>${esc(s.title)}</strong><small>${esc(s.when)} / ${esc(s.time)} / ${esc(s.cost)}</small><p>${esc(s.action)}</p></li>`).join('')}</ol>
        <h3>Model economics / disclosed assumptions</h3>${modelLedger}${whatIf}
      </article><article><h3>Valuation ledger</h3>${ledger([
        ['Peer curve at this TVL', usd(f.curve)], ['Weekly TVL factor', `${f.growth.toFixed(4)}×`], ['Tracking days / seasoning', `${r.age_days ?? 'Unreported'} / ${f.age.toFixed(4)}×`],
        ['Category premium', `${f.premium.toFixed(4)}× (n=${r.category_premium.n})`], ['Launch odds (cohort)', oddsPct(r.launch_odds)],
        ['Value if launched (whole USD)', new Intl.NumberFormat('en-US').format(r.conditional_value_usd)],
        ['Implied value (whole USD)', new Intl.NumberFormat('en-US').format(r.implied_value_usd)], ['Error-based range', range(r)],
        ['TVL-only refit sensitivity', usd(r.valuation_sensitivity.tvl_only)], ['Without age / without growth', `${usd(r.valuation_sensitivity.no_age)} / ${usd(r.valuation_sensitivity.no_growth)}`],
      ])}<p class="muted">${r.extrapolated ? 'TVL is outside the traded fitting sample. ' : ''}The range applies traded-peer errors to a hypothetical circulating market cap. Implied value = value if launched × cohort odds; the odds are a historical base rate, not a promise.</p>
      <h3>Nearest traded references</h3><ul class="peers">${r.comparables.map(slug => {
        const p = peerBySlug.get(slug);
        return `<li><b>${esc(p.name)}</b><span>${esc(p.category ?? 'Unclassified')}<br>${usd(p.tvl_usd)} TVL / ${usd(p.mcap_usd)} cap</span></li>`;
      }).join('')}</ul><p class="muted">Nearest by log TVL distance, with penalties for different sector (+1.10) and no shared chain (+0.35). These references explain locality; the ranked estimate uses the full fit.</p></article></div>`;
  }

  function openDetail(row, source) {
    previousFocus = source;
    active = row;
    renderChart();
    renderDetail();
    $('dossier').showModal();
    $('dossier').scrollTop = 0;
  }
  function renderRecords() {
    const mode = $('record-mode').value, query = $('record-search').value.trim().toLowerCase();
    const pool = mode === 'peers' ? peers : data.exclusions.filter(p => (p.reason === 'Recorded token') === (mode === 'live'));
    const matched = pool.filter(p => [p.slug, p.name, p.category, p.symbol, p.reason].join(' ').toLowerCase().includes(query));
    $('record-count').textContent = `${matched.length} of ${pool.length} records`;
    $('record-list').innerHTML = matched.length ? `<ul>${matched.map(p => `<li><strong>${esc(p.name)}</strong> <span class="muted">${esc(p.slug)} / ${esc(p.reason ?? 'Fitted peer')} / ${usd(p.tvl_usd)} TVL${p.mcap_usd > 0 ? ` / ${usd(p.mcap_usd)} market cap` : ''}</span></li>`).join('')}</ul>` : '<p class="empty">No matching records.</p>';
  }
  function renderFunnel() {
    const reasons = new Map();
    for (const p of data.exclusions) reasons.set(p.reason, (reasons.get(p.reason) ?? 0) + 1);
    const parts = [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([reason, n]) => `${n} ${reason.toLowerCase()}`);
    $('record-summary').textContent = `${counts.total} protocols read = ${counts.ranked} ranked + ${data.exclusions.length} set aside, each group for one reason: ${parts.join('; ')}. Ranked rows record no token and stand alone; recorded tokens fit the curve instead. Product screens (bridges, liquid staking, exchange custody, wrappers, versioned releases) carry another token's economics.`;
  }

  $('inputs').innerHTML = fields.map(([key, label, value, min, max, step]) => `<label>${label}<input required type="number" id="s-${key}" min="${min}" max="${max}" step="${step}" value="${value}"></label>`).join('');
  $('inputs').addEventListener('input', () => {
    const controls = fields.map(([key]) => [key, $(`s-${key}`)]);
    const valid = controls.every(([, el]) => el.validity.valid && Number.isFinite(el.valueAsNumber));
    $('invalid').hidden = valid;
    if (!valid) return;
    scenario = Object.fromEntries(controls.map(([key, el]) => [key, el.valueAsNumber]));
    page = 0;
    renderBoard();
    renderCompare();
    if ($('dossier').open) renderDetail();
  });
  setOptions('category', rows.map(row => row.category));
  setOptions('chain', rows.flatMap(row => row.chains));
  $('filters').addEventListener('input', () => { page = 0; renderBoard(); });
  for (const [id, delta] of [['prev', -1], ['next', 1]]) $(id).addEventListener('click', () => { page += delta; renderBoard(); $('board-title').scrollIntoView({ block: 'start' }); });
  $('dossier').addEventListener('close', () => {
    (previousFocus?.isConnected ? previousFocus : $('board')).focus({ preventScroll: true });
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    const { open, close, compare, clear } = button.dataset;
    if (open) openDetail(bySlug.get(open), button);
    if (close !== undefined) $('dossier').close();
    if (clear !== undefined) {
      for (const id of ['search', 'category', 'chain', 'cohort', 'verdict']) $(id).value = '';
      page = 0;
      renderBoard();
      $('search').focus();
    }
    if (compare) {
      if (chosen.has(compare)) chosen.delete(compare);
      else if (chosen.size === 3) {
        $('compare-status').textContent = 'Comparison is full. Remove a candidate before adding another.';
        return;
      } else chosen.add(compare);
      $('compare-status').textContent = `${bySlug.get(compare).name} ${chosen.has(compare) ? 'added to' : 'removed from'} comparison. ${chosen.size} selected.`;
      const host = button.closest('#detail,#comparison,#table');
      renderBoard(); renderCompare();
      if ($('dossier').open) renderDetail();
      const replacement = [...host.querySelectorAll('[data-compare]')].find(el => el.dataset.compare === compare);
      (replacement ?? $('board')).focus({ preventScroll: true });
    }
  });
  $('record-mode').addEventListener('change', renderRecords);
  $('record-search').addEventListener('input', renderRecords);
  renderFunnel();
  $('provenance').innerHTML = `<p>${esc(data.source)}</p><p class="muted num">Snapshot SHA-256 ${esc(data.snapshot_sha256)}</p><p class="muted">Watchlist floor ${usd(data.floor_usd)} / ${counts.below} ranked below it. Implied values are odds-weighted model claims, never make.fun's; nothing here says if or when a token launches. Fee, slippage and yield figures are disclosed assumptions. Not investment advice.</p>`;
  $('missing').hidden = true;
  $('fieldbook').hidden = false;
  $('provenance').hidden = false;
  renderEvidence(); renderAudit(); renderChart(); renderBoard(); renderRecords();
  new ResizeObserver(renderChart).observe($('chart'));
})();
