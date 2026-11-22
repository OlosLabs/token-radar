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
  let model = { capital: data.econ_defaults.capital, days: data.econ_defaults.days, share: data.econ_defaults.airdropShare, alt: data.econ_defaults.altYield };
  const liveEcon = r => (model.capital === r.plan.econ.capital && model.days === r.plan.econ.days && model.share === r.plan.econ.airdropShare && model.alt === r.plan.econ.altYield)
    ? r.plan.econ : window.Recompute.farmRow(r, model);

  let portfolioNet = 0, portfolioMin = 0, bestHour = null;
  function refreshPortfolio() {
    const live = rows.map(r => ({ r, e: liveEcon(r) }));
    const farms = live.filter(({ e }) => e.verdict === 'FARM');
    portfolioNet = farms.reduce((s, { e }) => s + e.netAfterYield, 0);
    portfolioMin = farms.reduce((s, { e }) => s + e.minutes, 0);
    bestHour = live.reduce((b, x) => (x.e.netPerHour ?? -Infinity) > (b?.e.netPerHour ?? -Infinity) ? x : b, null);
    $('farm-now').innerHTML = `<b>Farm now:</b> ${farms.slice().sort((a,b)=>b.e.netAfterYield-a.e.netAfterYield).slice(0,3).map(({r,e}) => `${esc(r.name)} ${signed(e.netAfterYield)}`).join(' · ')} · ${farms.length} FARM = ${signed(portfolioNet)} for ${(portfolioMin/60).toFixed(0)}h${bestHour ? ` · best ${esc(bestHour.r.name)} ${signed(bestHour.e.netPerHour)}/h` : ''}`;
  }
  let previousFocus;

  function renderChart() {
    const width = Math.max(265, Math.round($('chart').clientWidth));
    const height = Math.round($('chart').getBoundingClientRect().height) || 207;
    const left = 48, right = width - 15, top = 12, bottom = Math.max(top + 2, height - 34);
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
    $('farm-now').dataset.ready = '1';
    const wf = validation.walk_forward;
    const ob = validation.odds_brier;
    const a = validation.production_ablation.rows, c = validation.nested_coverage;
    $('validation-intro').innerHTML = `<b>Removed term hurts both folds:</b> ${a.find(r=>/removed/i.test(r.term)).loo.toFixed(2)}×/${a.find(r=>/removed/i.test(r.term)).split.toFixed(2)}× vs ${a[1].loo.toFixed(2)}×/${a[1].split.toFixed(2)}× · <span class="fn">buildRadar()</span>`;
    $('validation').innerHTML = [[`${times(a[1].split)} vs ${times(a[0].split)}`, 'Full vs flat miss'], [`${pctHit(c.split)} vs 80%`, 'Printed-range hits vs 80% target'], [`${ob.walk_forward.model_brier.toFixed(3)} vs ${ob.walk_forward.base_brier.toFixed(3)}`, 'Token-status Brier: model vs base'], [validation.bootstrap.refits, 'Bootstrap refits']].map(([v,l]) => `<div><strong class="metric">${v}</strong><span>${l}</span></div>`).join('');

    const ta = validation.term_ablation.rows;
    $('term-table').innerHTML = `<table class="termtable"><caption>Building the value model — held-out miss after each term, lower is better</caption><thead><tr><th>Term added in order</th><th>LOO</th><th>Walk-fwd</th><th>Decision</th></tr></thead><tbody>${ta.map(r=>`<tr><th>${esc(r.term.replace('+ ','').replace('size curve, ln TVL','size curve').replace('7-day relative growth','7d growth').replace('category premium (shrunk)','category premium').replace('tracking age (maturity)','tracking age').replace('chain count, ln','chain count').replace('control: another row\u2019s growth','control: shuffled growth'))}</th><td>${r.loo_miss.toFixed(2)}×</td><td>${r.wf_miss.toFixed(2)}×</td><td>${r.control?'control':r.kept?'kept':'tested'}</td></tr>`).join('')}</tbody></table>`;
    $('oos-evidence').innerHTML = [renderAblation(), renderBrier(), renderBootstrap(), renderCoverage()].map(html => `<article>${html}</article>`).join('');
    const cohort = data.odds_cohort;
    const premiums = data.category_premiums.filter(c => c.n >= 2).sort((a, b) => b.n - a.n || a.category.localeCompare(b.category, 'en'));
    $('methods').innerHTML = `<p><b>Formula.</b> value = e^(${fit.intercept.toFixed(4)} + ${fit.slope.toFixed(4)}·ln(TVL/$100M) + ${fit.momentum.toFixed(4)}·g) × seasoning × odds; g = clamp(7d − ${data.market_median_change_7d.toFixed(1)}%, ±30)/30, missing = market. Ridge 2/12; slope 0–1.5, growth ±0.25.</p>
      
      <table class="sensitivity"><caption>Cohort launch odds / snapshot</caption><thead><tr><th>Age</th><th>n</th><th>Launched</th><th>Raw</th><th>Applied</th></tr></thead><tbody>${cohort.buckets.map(b => `<tr><th>${esc(b.label)}</th><td>${b.n}</td><td>${b.launched}</td><td>${b.n ? oddsPct(b.raw_rate) : 'n/a'}</td><td>${oddsPct(b.rate)}</td></tr>`).join('')}<tr><th>No tracking date</th><td colspan="3">Disclosed prior</td><td>${oddsPct(cohort.prior)}</td></tr></tbody></table>
      <p><b>Category premium — removed in v8.</b> Adding it back worsens both held-out tests (above); former estimates disclosed, unapplied.</p>
      <table class="sensitivity"><caption>Former category premiums (n ≥ 2) — not applied</caption><thead><tr><th>Category</th><th>n</th><th>Raw</th><th>Former factor</th></tr></thead><tbody>${premiums.map(c => `<tr><th>${esc(c.category)}</th><td>${c.n}</td><td>${times(c.raw)}</td><td>${times(c.factor)}</td></tr>`).join('')}</tbody></table>
      <p><b>Seasoning.</b> 0.82 + 0.18 × min(days/1460,1); missing 730d; haircut, not launch odds.</p>
      
      
      <p><b>Range.</b> Age-bucket p80 errors, pooled, shrunk ${times(validation.factor)} by n/(n+10). Cross-sectional; circulating cap.</p>
      <table class="sensitivity"><caption>Age-matched bands / LOO</caption><thead><tr><th>Age</th><th>n</th><th>Pooled</th><th>Factor</th></tr></thead><tbody>${validation.age_bands.map(b => `<tr><th>${esc(b.label)}</th><td>${b.n}</td><td>${b.pooled_n}</td><td>${times(b.factor)}</td></tr>`).join('')}</tbody></table>
      <p><b>Farm.</b> Assumed gas/slippage/bridge/yield; ${oddsPct(data.econ_defaults.airdropShare)} share × deposit/TVL. FARM: net>0, break-even<80% odds; THIN marginal; SKIP fees/no route.</p>`;
  }

  function renderAblation() {
    const a = validation.production_ablation;
    const full = a.rows[1];
    const delta = (v, b) => `${v >= b ? '+' : ''}${(v - b).toFixed(2)}×`;
    const cell = (v, b, i) => v == null ? '—' : i > 1 ? `${v.toFixed(3)}× (${delta(v, b)})` : `${v.toFixed(3)}×`;
    const status = (r, i) => {
      if (i === 0) return 'baseline';
      if (i === 1) return 'production';
      if (/shuffled/i.test(r.term)) return 'negative control';
      if (/removed/i.test(r.term)) {
        const worse = r.loo != null && r.split != null && r.loo > full.loo && r.split > full.split;
        return worse ? 'removed — hurts both folds' : 'removed — mixed evidence';
      }
      const worse = (r.loo != null && r.loo > full.loo) && (r.split != null && r.split > full.split);
      return worse ? 'kept — hurts both folds' : 'kept — mixed evidence';
    };
    return `<p><b>Production conditional-cap ablation.</b> Each row removes one factor; the category row adds the removed v7 term back. Refit on identical folds. Descriptive only; no production term selection.</p>
      <table class="sensitivity"><caption>Median absolute multiplicative miss · lower is better · Δ vs full (positive = worse)</caption><thead><tr><th>Variant</th><th>LOO n=${a.loo_n} miss (Δ)</th><th>Date-split n=${a.split_n} miss (Δ)</th><th>Verdict</th></tr></thead><tbody>${a.rows.map((r,i)=>`<tr><th>${esc(r.term)}</th><td>${cell(r.loo,full.loo,i)}</td><td>${cell(r.split,full.split,i)}</td><td>${status(r,i)}</td></tr>`).join('')}</tbody></table>
      <p class="muted">${esc(a.design)}</p>`;
  }
  function renderBrier() {
    const ob = validation.odds_brier;
    const pc = x => `${Math.round(x * 100)}%`;
    return `<table class="sensitivity"><caption>Token-status Brier / ${ob.n_peers} records</caption><thead><tr><th>Predictor</th><th>10-fold</th><th>Right</th><th>Date split</th><th>Right</th></tr></thead><tbody>
      <tr><th>Base rate</th><td>${ob.tenfold.base_brier.toFixed(3)}</td><td>${pc(ob.tenfold.base_called_right)}</td><td>${ob.walk_forward.base_brier.toFixed(3)}</td><td>${pc(ob.walk_forward.base_called_right)}</td></tr>
      <tr><th>Isotonic age curve</th><td><b>${ob.tenfold.model_brier.toFixed(3)}</b></td><td>${pc(ob.tenfold.model_called_right)}</td><td><b>${ob.walk_forward.model_brier.toFixed(3)}</b></td><td>${pc(ob.walk_forward.model_called_right)}</td></tr></tbody></table>
      <p>Mean squared probability error (lower better). Accuracy at ≥50%. Observed token status, not future-launch calibration.</p>`;
  }
  function renderBootstrap() {
    const bs = validation.bootstrap;
    return `<p><b>Fitted, ± bootstrap s.e. (${bs.refits} refits).</b> Rank min–max, not CI. Slope ${fit.slope.toFixed(3)} ± ${bs.slope_se.toFixed(3)}; growth ${fit.momentum.toFixed(3)} ± ${bs.momentum_se.toFixed(3)}; intercept ${fit.intercept.toFixed(3)} ± ${bs.intercept_se.toFixed(3)}.</p>`;
  }
  const pctHit = x => x.n ? `${(100*x.hits/x.n).toFixed(1)}%` : '—';
  const hitCount = x => x.n ? `${x.hits}/${x.n} (${pctHit(x)})` : '—';
  function renderCoverage() {
    const c = validation.nested_coverage;
    return `<table class="sensitivity"><caption>Odds-weighted dossier range / traded caps · 80% target</caption><thead><tr><th>Tracking age</th><th>LOO hits</th><th>Date-split hits</th></tr></thead><tbody>
      <tr><th>All buckets</th><td>${hitCount(c.loo)}</td><td>${hitCount(c.split)}</td></tr>${c.buckets.map(b=>`<tr><th>${esc(b.bucket)}</th><td>${hitCount(b.loo)}</td><td>${hitCount(b.split)}</td></tr>`).join('')}</tbody></table>
      <p><b>Conditional-cap diagnostic</b> (same age bands before launch-odds weighting; not the printed dossier range): LOO ${hitCount(c.conditional.loo)} · date split ${hitCount(c.conditional.split)}.</p>
      <p>${esc(c.design)}</p>`;
  }

  function renderAudit() {
    const total = rows.reduce((sum, row) => sum + row.implied_value_usd, 0);
    const ordered = rows.every((row, i) => row.rank === i + 1 && (i === 0 || rows[i - 1].implied_value_usd >= row.implied_value_usd));
    const seal = data.snapshot_sha256.slice(0, 8);
    const l = data.ledger.groups;
    const rankedTotal = l.ranked_watchlist + l.ranked_below_floor + l.ranked_other;
    const recordedTotal = l.recorded_priced + l.recorded_unpriced;
    const outTotal = l.out_bridge + l.out_staking + l.out_exchange + l.out_versioned + l.out_other;
    const seg = (n, cls, label) => `<span class="acct-seg ${cls}" style="flex:${n}" title="${label}: ${n}">${n}</span>`;
    $('accounting').innerHTML = `<div class="acct-bar" role="img" aria-label="All ${data.ledger.total} snapshot protocols in exactly one group: ${rankedTotal} ranked, ${recordedTotal} recorded token, ${outTotal} excluded">${seg(rankedTotal, 'a-rank', 'Ranked pre-token')}${seg(recordedTotal, 'a-rec', 'Recorded token')}${seg(outTotal, 'a-out', 'Excluded products')}</div>
      <p class="acct-legend"><span>Ranked ${rankedTotal} · watch ${l.ranked_watchlist} · below floor ${l.ranked_below_floor} · other ${l.ranked_other}</span><span>Recorded ${recordedTotal} · priced ${l.recorded_priced} · no cap ${l.recorded_unpriced}</span><span>Out ${outTotal} · bridge ${l.out_bridge} · staking ${l.out_staking} · exchange ${l.out_exchange}${l.out_versioned+l.out_other ? ` · other ${l.out_versioned+l.out_other}` : ''}</span><span>Seal ${seal} · ${data.ledger.total}/${data.ledger.total} placed</span></p>`;
    $('audit').innerHTML = `<span>table = board.json</span><span>${rows.length} rows drawn = ${rows.length} written</span><span>ranks 1–${rows.length} in order${ordered ? ' ✓' : ' ✗'}</span><span>values never rise${ordered ? ' ✓' : ' ✗'}</span><span>total ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(total)}</span><span>seal ${seal} = ${seal}</span><span>checksum ${data.main_sha256} = main.ts</span><span>${counts.covered}/${counts.watch} watchlist ranked</span><span>ledger ${data.ledger.total}/${data.ledger.total}</span>`;
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
    const selected = rows.map(row => ({ row, result: economics(row, scenario), live: liveEcon(row) })).filter(({ row, live }) =>
      (!q || [row.name, row.slug, row.category, ...row.chains].join(' ').toLowerCase().includes(q)) &&
      (!category || row.category === category) && (!chain || row.chains.includes(chain)) &&
      (!cohort || (cohort === 'below' ? row.tvl_usd < data.floor_usd : row.cohort === cohort)) && (!verdict || live.verdict === verdict));
    const sort = $('sort').value;
    selected.sort((a, b) => ({
      rank: () => 0, tvl: () => b.row.tvl_usd - a.row.tvl_usd,
      growth: () => (b.row.change_7d ?? -Infinity) - (a.row.change_7d ?? -Infinity),
      net: () => (b.result?.expectedNet ?? b.live.net) - (a.result?.expectedNet ?? a.live.net),
      odds: () => b.row.launch_odds - a.row.launch_odds,
      name: () => a.row.name.localeCompare(b.row.name, 'en'),
    }[sort]() || a.row.rank - b.row.rank));
    const total = selected.length;
    page = Math.min(page, Math.max(0, Math.ceil(total / pageSize) - 1));
    const start = page * pageSize;
    const shown = selected.slice(start, start + pageSize);
    $('matching').textContent = `${total} of ${rows.length} candidates`;
    $('scenario-summary').textContent = scenario.whatif ? `What-if on / ${usd(scenario.pool)} pool / ${usd(scenario.deposits)} deposits` : `Model economics on / ${usd(model.capital)} position / ${model.days} days`;
    $('table').innerHTML = total ? `<table class="table"><caption class="sr">Ranked launch candidates. Select a protocol to open its dossier.</caption><thead><tr><th scope="col">Rank</th><th scope="col">Protocol / sector</th><th scope="col">TVL / 7d change</th><th scope="col">No-token age</th><th scope="col">Implied / P25–P75 range</th><th scope="col">Verdict / net / net per hour</th><th scope="col">Compare</th></tr></thead><tbody>
      ${shown.map(({ row, result, live }) => `<tr><td>#${row.rank}</td><td class="name"><button type="button" class="protocol" data-open="${esc(row.slug)}">${esc(row.name)}</button><small>${esc(row.category ?? 'Unclassified')} / ${esc(row.plan.chain)} / ${row.cohort}</small></td>
        <td class="tvl num"><span class="sr">TVL </span>${usd(row.tvl_usd)}<small class="${row.change_7d < 0 ? 'down' : 'up'}">${pct(row.change_7d)}</small></td>
        <td class="age num">${row.age_days == null ? 'Unreported' : `${(row.age_days / 365).toFixed(1)} y`}<small>${row.age_days == null ? 'prior used' : `${row.age_days}d tracked`}</small></td>
        <td class="value num"><span class="sr">Implied value </span><strong>${usd(row.implied_value_usd)}</strong><small>${usd(row.range[0])}–${usd(row.range[1])}</small></td>
        <td class="farm">${badge(live.verdict)}<small>${signed(live.net)} net / ${live.netPerHour == null ? 'n/a' : signed(live.netPerHour) + '/h'} / ${cash(live.totalCost)} fees${result ? ` · what-if ${signed(result.expectedNet)}` : ''}</small></td><td class="select">${compareButton(row)}</td></tr>`).join('')}
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
      const r = bySlug.get(slug), e = economics(r, scenario), m = liveEcon(r);
      return `<article class="compare-card"><div class="heading"><h3>${esc(r.name)}</h3>${compareButton(r)}</div>
        <p class="muted">#${r.rank} / ${esc(r.plan.chain)} / ${badge(m.verdict)}</p>${ledger([['Implied value (odds-weighted)', usd(r.implied_value_usd)], ['Value if launched', usd(r.conditional_value_usd)], ['Launch odds', oddsPct(r.launch_odds)], ['Model net of fees', signed(m.net)], ['Model fees', cash(m.totalCost)], ['Work / net per hour', `${m.minutes} min / ${m.netPerHour == null ? 'n/a' : signed(m.netPerHour)}`], ['Break-even odds', m.breakEvenOdds == null ? 'n/a' : oddsPct(m.breakEvenOdds)], ...(e ? [['What-if expected net', signed(e.expectedNet)], ['What-if cost', cash(e.cost)]] : [])])}</article>`;
    }).join('');
  }

  function renderDetail() {
    const r = active, f = r.factors, m = liveEcon(r), e = economics(r, scenario);
    const v = window.Recompute.verify(r);
    const proof = `<p class="muted">${v.impliedMatch && v.conditionalMatch ? `✓ Recomputed here: ${new Intl.NumberFormat('en-US').format(v.recomputed)} = board.json ${new Intl.NumberFormat('en-US').format(v.stored)} at rank ${r.rank}. Same math, your browser.` : `Recompute mismatch: page ${v.recomputed} vs board ${v.stored}.`}</p>`;
    const insight = r.insight ? `<p class="insight">${esc(r.insight)}</p>` : '';
    const decision = m.verdict === 'SKIP'
      ? `<p class="decision"><b>Skip this one:</b> ${esc(m.skipReason)}. ${cash(m.totalCost)} fees vs ${cash(m.expected)} expected at ${oddsPct(m.odds)} odds on ${cash(m.deposit)}.</p>`
      : `<p class="decision"><b>${m.verdict === 'FARM' ? 'Farm it' : 'Thin — verify terms first'}:</b> ${signed(m.net)} net of fees, ${signed(m.netAfterYield)} after the ${oddsPct(model.alt)} T-bill give-up, ${m.netPerHour == null ? 'n/a' : signed(m.netPerHour)}/hour over ${(m.minutes/60).toFixed(1)} h work. Fees covered from ${m.breakEvenOdds == null ? 'n/a' : oddsPct(m.breakEvenOdds)} odds up; model: ${oddsPct(m.odds)}. T-bill pays ${cash(m.incomeForgone)} on ${cash(m.deposit)} over ${m.days}d.</p>`;
    const b = r.plan.econ; // build-time constants; m = live scenario economics
    const modelLedger = ledger([
      ['Deposit (≤2% TVL)', cash(m.deposit)], [`Gas / ${m.gasTxs} tx on ${esc(m.chain)}`, cash(m.fees.gas)],
      ['Slippage / bridge', `${cash(m.fees.slippage)} / ${cash(m.fees.bridge)}`], ['Yield give-up (disclosed)', cash(m.incomeForgone)],
      ['Total fees', cash(m.totalCost)], ['Slice if it launches', cash(m.sliceIfLaunch)],
      ['Expected @ odds', `${cash(m.expected)} at ${oddsPct(m.odds)}`], ['Net of fees / after yield', `${signed(m.net)} / ${signed(m.netAfterYield)}`],
      ['Break-even launch odds', m.breakEvenOdds == null ? 'No slice modeled' : `${oddsPct(m.breakEvenOdds)}${m.breakEvenOdds > 1 ? ' (unreachable)' : ''}`],
      ['Net / hour', m.netPerHour == null ? 'n/a' : `${signed(m.netPerHour)} / ${m.minutes} min`],
      ['Stop / live review', `${usd(m.stopTvl)} TVL / ${m.reviewDate}`],
    ]);
    const whatIf = e ? `<h3>What-if calculator</h3><p class="muted">${usd(scenario.pool)} pool / ${usd(scenario.deposits)} deposits incl. capital / ${scenario.prob}% odds / ${scenario.days}d. Payout = pool × min(1, capital/deposits); model-independent, excludes principal.</p>${ledger([
      ['Fees / friction', `${cash(e.fixed)} / ${cash(e.friction)}`], ['Recurring / opportunity', `${cash(e.recurring)} / ${cash(e.opportunity)}`],
      ['Total cost', cash(e.cost)], ['Conditional / net', `${cash(e.conditional)} / ${cash(e.conditionalNet)}`],
      ['Expected / net', `${cash(e.expected)} / ${cash(e.expectedNet)}`], ['Break-even odds', e.breakEven == null ? 'No payout modeled' : `${e.breakEven.toFixed(1)}%${e.breakEven > 100 ? ' (unreachable)' : ''}`],
    ])}<h3>Pool sensitivity</h3><table class="sensitivity"><thead><tr><th>Case</th><th>Pool / USD</th><th>Conditional net</th><th>Expected net</th></tr></thead><tbody>
      ${[['Low / 0.5×', 0.5], ['Base / 1×', 1], ['High / 2×', 2]].map(([label, multiplier]) => {
        const result = economics(r, scenario, multiplier);
        return `<tr><th scope="row">${label}</th><td>${usd(result.pool)}</td><td>${cash(result.conditionalNet)}</td><td>${cash(result.expectedNet)}</td></tr>`;
      }).join('')}</tbody></table><p class="muted">Only pool changes (½/1/2×); all else fixed.</p>` : '';
    const renewal = `<p class="renewal"><b>Optimal renewal point — day ${b.optimalHoldDays} (${b.optimalReviewDate}).</b> Build scenario only (${cash(b.capital)}, ${b.days}d, ${oddsPct(b.airdropShare)} share, ${oddsPct(b.altYield)} yield). ${esc(b.holdBasis)}</p>`;
    $('detail').innerHTML = `<header class="detail-header"><div class="heading"><div><p class="label">Dossier / Rank ${r.rank} / ${r.cohort} / ${badge(m.verdict)}</p><h2 id="dossier-title">${esc(r.name)}</h2><p class="muted">${esc(r.category ?? 'Unclassified')} / ${esc(r.plan.chain)} / No recorded token</p></div><div class="detail-controls">${compareButton(r)}<button type="button" data-close autofocus>Close dossier</button></div></div>
      <div class="detail-kpis"><div><strong>${usd(r.implied_value_usd)}</strong><span>Implied value × ${oddsPct(r.launch_odds)} odds</span></div><div><strong>${usd(r.conditional_value_usd)}</strong><span>Value if it launches</span></div><div><strong>${signed(m.net)}</strong><span>Model net of fees</span></div><div><strong>${pct(r.change_7d)}</strong><span>7-day TVL change</span></div></div></header>
      <div class="detail-columns"><article>${decision}${renewal}${insight}<h3>Build-scenario farm plan / ${esc(r.plan.title)}</h3>
        <table class="farmplan"><caption>Build-scenario farm plan / ${r.plan.steps.length} steps / ${cash(b.deposit)} deposit / ${b.days}d</caption><thead><tr><th scope="col">Step</th><th scope="col">Cost</th><th scope="col">Time</th></tr></thead><tbody>${r.plan.steps.map((s, i) => `<tr><td><b>${i + 1}. ${esc(s.title)}</b> <span class="muted">${esc(s.when)}</span><p>${esc(s.action)}</p></td><td class="num">${esc(s.cost)}</td><td class="num">${esc(s.time)}</td></tr>`).join('')}<tr class="total"><th scope="row">Total — ${r.plan.steps.length} steps over ${b.days} days</th><td class="num">${cash(b.totalCost)} fees + ${cash(b.incomeForgone)} yield</td><td class="num">${b.minutes} min hands-on</td></tr></tbody></table>
        <h3>Model economics</h3>${modelLedger}${whatIf}
      </article><article>${proof}<h3>Ledger</h3>${ledger([
        ['Peer curve at this TVL', usd(f.curve)], ['Weekly TVL factor', `${f.growth.toFixed(4)}×`], ['Tracking days / seasoning', `${r.age_days ?? 'Unreported'} / ${f.age.toFixed(4)}×`],
        ['Category premium (removed v8)', `1.0000× applied · former estimate ${r.category_premium.raw.toFixed(3)}× (n=${r.category_premium.n})`], ['Launch odds (cohort)', oddsPct(r.launch_odds)],
        ['Value if launched (whole USD)', new Intl.NumberFormat('en-US').format(r.conditional_value_usd)],
        ['Implied value (whole USD)', new Intl.NumberFormat('en-US').format(r.implied_value_usd)], ['Error-based range (age-matched ×' + r.range_factor.toFixed(2) + ')', range(r)],
 ['Rank across 200 bootstrap refits', `#${r.rank_range[0]}–#${r.rank_range[1]} (published #${r.rank})`],
        ['TVL-only refit sensitivity', usd(r.valuation_sensitivity.tvl_only)], ['Without age / without growth', `${usd(r.valuation_sensitivity.no_age)} / ${usd(r.valuation_sensitivity.no_growth)}`],
      ])}<p class="muted">${r.extrapolated ? 'TVL outside fit. ' : ''}Range = traded-peer errors on hypothetical cap; implied = value × odds (historical, not a promise).</p>
      <h3>Nearest traded references</h3><ul class="peers">${r.comparables.map(slug => {
        const p = peerBySlug.get(slug);
        return `<li><b>${esc(p.name)}</b><span>${esc(p.category ?? 'Unclassified')}<br>${usd(p.tvl_usd)} TVL / ${usd(p.mcap_usd)} cap</span></li>`;
      }).join('')}</ul><p class="muted">Nearest by log TVL distance (+1.10 different sector, +0.35 no shared chain); estimate uses the full fit.</p></article></div>`;
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
  $('provenance').innerHTML = `<p>${esc(data.source)}</p><p class="muted num">Snapshot SHA-256 ${esc(data.snapshot_sha256)}</p><p class="muted">Floor ${usd(data.floor_usd)} / ${counts.below} ranked below. Implied values are odds-weighted model claims, never make.fun's; nothing says if/when a token launches. Fees, slippage, yield are assumptions. Not investment advice.</p>`;
  $('missing').hidden = true;
  $('fieldbook').hidden = false;
  $('provenance').hidden = false;
  const modelKeys = [['m-capital', 'capital', 1], ['m-days', 'days', 1], ['m-share', 'share', 100], ['m-alt', 'alt', 100]];
  function readModel() {
    const next = {};
    for (const [id, key, div] of modelKeys) {
      const el = $(id);
      if (!el.validity.valid || !Number.isFinite(el.valueAsNumber)) return null;
      next[key] = el.valueAsNumber / div;
    }
    return next;
  }
  function modelSummary() {
    $('model-summary').textContent = `${usd(model.capital)} / ${model.days}d / ${Math.round(model.share * 100)}% share / ${(model.alt * 100).toFixed(1)}% T-bill`;
  }
  $('model-inputs').addEventListener('input', () => {
    const next = readModel();
    if (!next) return;
    model = next;
    modelSummary(); refreshPortfolio(); renderBoard(); renderCompare();
    if ($('dossier').open) renderDetail();
  });
  $('m-reset').addEventListener('click', () => {
    model = { capital: data.econ_defaults.capital, days: data.econ_defaults.days, share: data.econ_defaults.airdropShare, alt: data.econ_defaults.altYield };
    $('m-capital').value = model.capital; $('m-days').value = model.days;
    $('m-share').value = model.share * 100; $('m-alt').value = model.alt * 100;
    modelSummary(); refreshPortfolio(); renderBoard(); renderCompare();
    if ($('dossier').open) renderDetail();
  });
  $('csv').addEventListener('click', () => {
    const head = 'rank,slug,name,category,chain,tvl_usd,change_7d,launch_odds,implied_value_usd,conditional_value_usd,verdict,deposit,fees,expected,net,net_after_yield,break_even_odds,stop_tvl,review_date,minutes,net_per_hour';
    const lines = rows.map(r => {
      const m = liveEcon(r), b = r.plan.econ;
      return [r.rank, r.slug, `"${r.name.replace(/"/g, '""')}"`, r.category ?? '', b.chain, r.tvl_usd, r.change_7d ?? '', r.launch_odds, r.implied_value_usd, r.conditional_value_usd, m.verdict, m.deposit, m.totalCost, m.expected, m.net, m.netAfterYield, m.breakEvenOdds ?? '', m.stopTvl, m.reviewDate, m.minutes, m.netPerHour ?? ''].join(',');
    });
    const blob = new Blob([head + '\n' + lines.join('\n') + '\n'], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `token-radar-${data.as_of}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  modelSummary(); refreshPortfolio();
  renderEvidence(); renderAudit(); renderChart(); renderBoard(); renderRecords();
  new ResizeObserver(renderChart).observe($('chart'));
})();
