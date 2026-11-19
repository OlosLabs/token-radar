# Token Radar · Valuation Fieldbook

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/OlosLabs/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/OlosLabs/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An offline research board for the sealed `token-radar-01` protocol snapshot. The fitted-peer value is a reproducible hypothetical circulating market-cap estimate if today's recorded protocol activity held—not a launch forecast, an FDV, or a promise from the bounty. Farm scenarios show explicit assumptions; rows with no verified action stay research-only.

## Run

Node.js 22.18 or later; no package install, runtime service, API key or network access is required.

```sh
mkdir -p /tmp/token-radar-output
node main.ts --input ../kit/token-radar-01-kit/input/snapshot.json --output /tmp/token-radar-output
python3 -m http.server 4173 --directory /tmp/token-radar-output
```

Open `http://127.0.0.1:4173/dashboard/`. At make.fun the sealed input is mounted at `/input/snapshot.json` and outputs at `/output`; the command's defaults use these mounts. For screenshots and interaction tests, use the local browser only.

## Model and source limits

The board keeps the full input watchlist and adds eligible discovery rows from below its floor. Tokenized comparable observations require a positive recorded market cap. Duplicate token IDs/tickers are reduced to one observation. A log-linear, ridge-stabilized fit uses log TVL and bounded seven-day TVL change; it is evaluated by leave-one-out refits against a refit flat log market-cap/TVL median baseline. Every row retains its curve value, bounded weekly factor, recorded-tracking-age factor, peer IDs, fitted range and extrapolation flag. The 80th percentile absolute held-out log residual produces a multiplicative range; it is a cross-sectional error sensitivity, not a calibrated prediction interval. A one-date sample cannot establish a genuine historical walk-forward test.

The tracking-date factor is an explicit age proxy, not an inferred launch probability. Identical leave-one-token-out folds compare the baseline, TVL-only, TVL+growth, TVL+age and full model; fold residuals, sample support, paired descriptive comparisons and top-ten rank sensitivity are exported. Growth does not improve median error in this sample; growth and age remain disclosed sensitivities, with no coefficient tuning or significance claim.

All plans remain research-only because the sealed snapshot does not verify deployments, assets, eligibility or exits. Six steps per protocol use source identity, category, recorded chain, TVL, growth and tracking age to guide verification and concrete skip decisions. Every source row is validated; the audit begins with the top ten then deduplicates the full watchlist.

The calculator is off by default, with zero assumed reward pool and eligible deposits. An explicit unverified what-if accepts a hypothetical eligible reward pool in USD and eligible deposits in USD (including your capital), independently of valuation and TVL. Conditional payout is pool × min(1, capital/deposits). Expected net deducts assumed fixed fees, friction, recurring fees and alternative yield; break-even odds and half/base/double reward-pool sensitivity use the same inputs across board, compare and dossier. Capital/hold default to $250/30 days, odds to 10%, fixed fees to $2 and friction to 35 bps; these are assumptions, never protocol facts.

The page is local HTML, CSS, JavaScript and generated JSON-as-script data. It fetches no remote font, chart, analytics, RPC, API or library.

## Tests and builds

```sh
node --test tests/model.test.mjs
python3 tests/browser_test.py
node main.ts --input ../kit/token-radar-01-kit/input/snapshot.json --output /tmp/token-radar-a
node main.ts --input ../kit/token-radar-01-kit/input/snapshot.json --output /tmp/token-radar-b
```

The browser test serves only the output from loopback, blocks off-origin requests, exercises mobile and desktop controls, and replaces `screenshots/` with authentic board, dossier and filtered-board JPEGs. The two builds must match at every path byte for byte and produce identical stdout. The official local gate command lives at `../kit/token-radar-01-kit/cli/makefun.mjs`.

## Official links

- Competition: https://make.fun/bounty/token-radar-01
- Latest requirements and reward/entry conditions: https://make.fun/api/competitions/token-radar-01/requirements
- The sealed source, eligibility list, farm actions and valuations are distinct: a row saying “no recorded token” reports a source record; it does not prove no token exists.
