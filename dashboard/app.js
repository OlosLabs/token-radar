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
  const pct = value => value == null ? 'Unreported' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
  const times = value => `${value.toFixed(2)}×`;
  const range = row => row.range.map(usd).join(' to ');
  const ledger = entries => `<dl class="ledger">${entries.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
  const { fields, defaults, economics } = window.FarmScenario;
  const { rows, peers, fit, validation, counts } = data;
  const bySlug = new Map(rows.map(row => [row.slug, row]));
  const peerBySlug = new Map(peers.map(peer => [peer.slug, peer]));
  const chosen = new Set();
  const pageSize = 10;
  let page = 0, active = rows[0], scenario = { ...defaults };
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
    $('chart').innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Market capitalization versus TVL for ${peers.length} traded peers. Selected: ${esc(active.name)}, ${usd(active.tvl_usd)} TVL and ${usd(active.implied_value_usd)} implied market value.">
      <defs><clipPath id="plot-clip"><rect x="${left}" y="${top}" width="${right-left}" height="${bottom-top}"/></clipPath></defs>${grid}
      <g clip-path="url(#plot-clip)"><polygon class="chart-band" points="${path}"/><path class="chart-fit" d="M${x(startX)} ${y(curve(startX))}L${x(endX)} ${y(curve(endX))}"/></g>
      ${peers.map((p, i) => `<circle class="chart-point${near.has(p.slug) ? ' chart-near' : ''}" cx="${x(tx[i])}" cy="${y(ty[i])}" r="${near.has(p.slug) ? 4 : 2.9}"><title>${esc(p.name)} | ${usd(p.tvl_usd)} TVL | ${usd(p.mcap_usd)} market cap</title></circle>`).join('')}
      <path class="chart-marker" d="M${sx} ${sy - 6}l6 6 -6 6 -6 -6z"/>
      <text class="chart-tick" x="${(left + right) / 2}" y="${height - 2}" text-anchor="middle">Total value locked</text></svg>`;
    $('chart-key').textContent = `${active.name} / ${usd(active.implied_value_usd)}`;
  }

  function renderEvidence() {
    $('edition').textContent = `${data.as_of} UTC`;
    $('coverage').innerHTML = [[`${counts.covered}/${counts.watch}`, 'Watchlist covered'], [counts.discovery, 'Discovery rows'], [counts.total, 'Snapshot records']]
      .map(([value, label]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join('');
    $('validation-intro').textContent = `Each of ${validation.folds} traded peers is priced using the rest. Median error factor: closer to 1× is better.`;
    $('validation').innerHTML = `<div><strong class="metric">${times(validation.miss.full)}</strong><span>Ranked model / age sensitivity</span></div><div><strong class="metric">${times(validation.miss.baseline)}</strong><span>Flat TVL multiple</span></div>`;
    $('methods').innerHTML = `<p><b>Model.</b> Market cap = e^(${fit.intercept.toFixed(4)} + ${fit.slope.toFixed(4)} × ln(TVL / $100M) + (${fit.momentum.toFixed(4)}) × g) × tracking factor. The weekly term g = clamp(7-day TVL change, −30, +30) / 30, with 0 for missing. Coefficients use ridge penalties 2 and 12, slope bounded 0 to 1.5 and growth bounded ±0.25.</p>
      <p><b>No-token duration proxy.</b> Tracking factor = 0.82 + 0.18 × min(tracking days / 1,460, 1); missing dates use 730 days. The first tracking date does not establish launch history. This conservative haircut is a research assumption.</p>
      <p><b>Same-fold audit (n=${validation.folds}).</b> TVL-only: ${times(validation.miss.tvl)}; TVL + growth: ${times(validation.miss.growth)}; TVL + age: ${times(validation.miss.age)}; ranked full model: ${times(validation.miss.full)}. The baseline refits the median log cap/TVL ratio. Growth does not improve median error here; growth and age remain explicit sensitivities, not established predictive gains.</p>
      <table class="sensitivity"><caption>Identical held-out folds / observed errors</caption><thead><tr><th>Variant / n</th><th>Median miss</th><th>80% error factor</th><th>Log residual p10–p90</th></tr></thead><tbody>${Object.entries(validation.diagnostics).map(([key, d]) => `<tr><th>${key} / ${d.n}</th><td>${times(d.median_miss)}</td><td>${times(d.error_factor_p80)}</td><td>${d.residual_p10_p90.map(v => v.toFixed(2)).join(' to ')}</td></tr>`).join('')}</tbody></table>
      <p>${validation.comparisons.map(c => `${c.a} beats ${c.b} on ${c.a_lower_error}/${c.n} folds`).join('; ')}. ${esc(validation.limits)}</p>
      <p><b>Top-10 rank sensitivity, TVL-only.</b> ${validation.top_rank_sensitivity.map(r => `${esc(bySlug.get(r.slug).name)} #${r.rank} → #${r.tvl_only_rank}`).join('; ')}. No coefficients or candidates were tuned using these results.</p>
      <p><b>Range.</b> Divide and multiply by ${times(validation.factor)}, the 80th percentile absolute held-out log error exponentiated. ${Math.round(validation.coverage * 100)}% of traded errors fit a band estimated without their own residual. Cross-sectional diagnostics do not calibrate pre-token outcomes or predict launch probability. Market cap is circulating, not FDV.</p>`;
  }

  function setOptions(id, values) {
    const select = $(id);
    for (const value of Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'en'))) select.add(new Option(value, value));
  }
  const verdictOf = result => result?.verdict ?? 'Research only';
  function compareButton(row) {
    const pressed = chosen.has(row.slug);
    return `<button type="button" class="compare-toggle" data-compare="${esc(row.slug)}" aria-pressed="${pressed}" aria-label="Compare ${esc(row.name)}">${pressed ? '✓' : '+'}</button>`;
  }
  function renderBoard() {
    const q = $('search').value.trim().toLowerCase();
    const category = $('category').value, chain = $('chain').value, cohort = $('cohort').value, verdict = $('verdict').value;
    const selected = rows.map(row => ({ row, result: economics(row, scenario) })).filter(({ row, result }) =>
      (!q || [row.name, row.slug, row.category, ...row.chains].join(' ').toLowerCase().includes(q)) &&
      (!category || row.category === category) && (!chain || row.chains.includes(chain)) &&
      (!cohort || (cohort === 'below' ? row.tvl_usd < data.floor_usd : row.cohort === cohort)) && (!verdict || verdictOf(result) === verdict));
    const sort = $('sort').value;
    selected.sort((a, b) => ({
      rank: () => 0, tvl: () => b.row.tvl_usd - a.row.tvl_usd,
      growth: () => (b.row.change_7d ?? -Infinity) - (a.row.change_7d ?? -Infinity),
      net: () => (b.result?.expectedNet ?? -Infinity) - (a.result?.expectedNet ?? -Infinity),
      name: () => a.row.name.localeCompare(b.row.name, 'en'),
    }[sort]() || a.row.rank - b.row.rank));
    const total = selected.length;
    page = Math.min(page, Math.max(0, Math.ceil(total / pageSize) - 1));
    const start = page * pageSize;
    const shown = selected.slice(start, start + pageSize);
    $('matching').textContent = `${total} of ${rows.length} candidates`;
    $('scenario-summary').textContent = scenario.whatif ? `Unverified what-if / ${usd(scenario.pool)} pool / ${usd(scenario.deposits)} eligible deposits` : 'Research only / calculator off';
    $('table').innerHTML = total ? `<table class="table"><caption class="sr">Ranked launch candidates. Select a protocol to open its dossier.</caption><thead><tr><th scope="col">Rank</th><th scope="col">Protocol / sector</th><th scope="col">TVL / 7d change</th><th scope="col">Implied value / range</th><th scope="col">Farm result / expected net</th><th scope="col">Compare</th></tr></thead><tbody>
      ${shown.map(({ row, result }) => `<tr><td>#${row.rank}</td><td class="name"><button type="button" class="protocol" data-open="${esc(row.slug)}">${esc(row.name)}</button><small>${esc(row.category ?? 'Unclassified')} / ${esc(row.plan.chain)} / ${row.cohort}</small></td>
        <td class="tvl num"><span class="sr">TVL </span>${usd(row.tvl_usd)}<small class="${row.change_7d < 0 ? 'down' : 'up'}">${pct(row.change_7d)}</small></td>
        <td class="value num"><span class="sr">Implied value </span><strong>${usd(row.implied_value_usd)}</strong><small>${range(row)}</small></td>
        <td class="farm">${result ? 'Unverified what-if' : verdictOf(result)}<small>${result ? `${cash(result.expectedNet)} expected net / ${cash(result.cost)} cost` : 'Verify eligibility, deployment & exit'}</small></td><td class="select">${compareButton(row)}</td></tr>`).join('')}
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
      const r = bySlug.get(slug), e = economics(r, scenario);
      return `<article class="compare-card"><div class="heading"><h3>${esc(r.name)}</h3>${compareButton(r)}</div>
        <p class="muted">#${r.rank} / ${esc(r.plan.chain)} / Research only</p>${ledger([['Value if launched', usd(r.implied_value_usd)], ['Error-based range', range(r)], ['Conditional payout', e ? cash(e.conditional) : 'No scenario'], ['What-if expected net', e ? cash(e.expectedNet) : 'Research only'], ['Assumed cost', e ? cash(e.cost) : 'No modeled position']])}</article>`;
    }).join('');
  }

  function renderDetail() {
    const r = active, f = r.factors, e = economics(r, scenario);
    const base = e ? ledger([
      ['One-time gas / extra fees', cash(e.fixed)], ['Route friction', cash(e.friction)], ['Recurring fees', cash(e.recurring)], ['Opportunity cost', cash(e.opportunity)],
      ['Total cost', cash(e.cost)], ['Conditional payout / net', `${cash(e.conditional)} / ${cash(e.conditionalNet)}`],
      ['Expected payout / net', `${cash(e.expected)} / ${cash(e.expectedNet)}`], ['Break-even joint odds', e.breakEven == null ? 'No payout modeled' : `${e.breakEven.toFixed(1)}%${e.breakEven > 100 ? ' (unreachable)' : ''}`],
    ]) : '<p class="muted">No position modeled. The research timeline can be completed without allocating funds.</p>';
    const sensitivity = e ? `<h3>Reward-pool sensitivity</h3><table class="sensitivity"><thead><tr><th>Case</th><th>Pool / USD</th><th>Conditional net</th><th>Expected net</th></tr></thead><tbody>
      ${[['Low / 0.5×', 0.5], ['Base / 1×', 1], ['High / 2×', 2]].map(([label, multiplier]) => {
        const result = economics(r, scenario, multiplier);
        return `<tr><th scope="row">${label}</th><td>${usd(result.pool)}</td><td>${cash(result.conditionalNet)}</td><td>${cash(result.expectedNet)}</td></tr>`;
      }).join('')}</tbody></table><p class="muted">Only the hypothetical reward pool changes: half/base/double. Eligible deposits, costs, capital, hold and odds stay fixed. Valuation and snapshot TVL never enter payout.</p>` : '';
    $('detail').innerHTML = `<header class="detail-header"><div class="heading"><div><p class="label">Protocol dossier / Rank ${r.rank} / ${r.cohort}</p><h2 id="dossier-title">${esc(r.name)}</h2><p class="muted">${esc(r.category ?? 'Unclassified')} / ${esc(r.plan.chain)} / No recorded token</p></div><div class="detail-controls">${compareButton(r)}<button type="button" data-close autofocus>Close dossier</button></div></div>
      <div class="detail-kpis"><div><strong>${usd(r.implied_value_usd)}</strong><span>Implied market value</span></div><div><strong>${usd(r.tvl_usd)}</strong><span>Snapshot TVL</span></div><div><strong>${pct(r.change_7d)}</strong><span>7-day TVL change</span></div></div></header>
      <div class="detail-columns"><article><h3>Research timeline</h3><p class="muted">${esc(r.plan.title)} / ${r.plan.research ? 'Read-only' : `${usd(scenario.capital)} budget / ${scenario.days} days`}. Estimates; verify the deployment and terms first.</p>
        <ol class="timeline">${r.plan.steps.map((s, i) => `<li><strong>${esc(s.title)}</strong><small>${esc(i === 3 && !r.plan.research ? `Day ${scenario.days} or sooner` : s.when)} / ${esc(s.time)} / ${esc(s.cost)}</small><p>${esc(i === 1 && !r.plan.research ? s.action.replace('$250', cash(scenario.capital)) : s.action)}</p></li>`).join('')}</ol>
        <h3>Farm economics / unverified what-if</h3><p class="muted">Research only: deployment, asset, eligibility and exit are unknown. ${usd(scenario.pool)} hypothetical eligible reward pool / ${usd(scenario.deposits)} assumed eligible deposits, including your capital / ${scenario.prob}% assumed joint launch-and-eligibility odds over ${scenario.days} days. Conditional payout = pool × min(1, capital / eligible deposits). Rewards exclude principal. Enable the calculator in Shared farm assumptions; a numeric result does not verify a plan.</p>${base}${sensitivity}
      </article><article><h3>Valuation ledger</h3>${ledger([
        ['Peer curve at this TVL', usd(f.curve)], ['Weekly TVL factor', `${f.growth.toFixed(4)}×`], ['Tracking days / factor', `${r.age_days ?? 'Unreported'} / ${f.age.toFixed(4)}×`],
        ['Implied value (whole USD)', new Intl.NumberFormat('en-US').format(r.implied_value_usd)], ['Error-based range', range(r)],
        ['TVL-only refit sensitivity', usd(r.valuation_sensitivity.tvl_only)], ['Without age / without growth', `${usd(r.valuation_sensitivity.no_age)} / ${usd(r.valuation_sensitivity.no_growth)}`],
      ])}<p class="muted">${r.extrapolated ? 'TVL is outside the traded fitting sample. ' : ''}The range applies traded-peer errors to a hypothetical circulating market cap.</p>
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
  $('record-summary').textContent = `${counts.total} source records. ${counts.recorded} record a token identifier or positive market cap and are not ranked. Discovery screens visible product markers; parent metadata is available only through the official watchlist result.`;
  $('provenance').innerHTML = `<p>${esc(data.source)}</p><p class="muted num">Snapshot SHA-256 ${esc(data.snapshot_sha256)}</p><p class="muted">Watchlist floor ${usd(data.floor_usd)} / ${counts.below} ranked below it. Estimates describe a hypothetical launch value, without forecasting timing or rewards.</p>`;
  $('missing').hidden = true;
  $('fieldbook').hidden = false;
  $('provenance').hidden = false;
  renderEvidence(); renderChart(); renderBoard(); renderRecords();
  new ResizeObserver(renderChart).observe($('chart'));
})();
