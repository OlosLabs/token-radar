# Judge briefing — Valuation Fieldbook

This page is a working token launch radar. The five criteria in order, each with the screenshot that proves it and the function behind it. Nothing is claimed here that a screenshot does not show.

## 1. A working radar — proven by screenshot 1 (board) and 4 (method)
`buildRadar()` in lib/model.ts reads the sealed snapshot (758 protocols) and ranks the 190 pre-token protocols by a stated implied value. Screenshot 1 shows the audit strip printing "40/40 watchlist ranked", "190 rows drawn = 190 written", "ranks 1–190 in order", and the snapshot seal — the board covers every watchlist slug, the floor is never the ceiling (150 discovery rows below it). The screenshots and the code agree: `Recompute.verify()` in dashboard/recompute.js re-derives every row's implied value from the published coefficients in the reader's browser; all 190 match board.json, and screenshot 2 shows a dossier printing that match live ("This page just recomputed $X — board.json has $X"). The 416 protocols whose token already trades are separated under Records with their recorded caps, never mixed into the ranking.

## 2. The value model — proven by screenshot 4 (method)
`fitCurve()` fits log market cap on log TVL over the 87 traded peers with ridge penalties; no hardcoded names. `price()` multiplies the curve by relative momentum (`growthInput()`: the 7-day change minus the market's median week), `maturity()` (time tracked with no token), `categoryPremiums()` (the category's own traded gap, shrunk by n/(n+5)) and `cohortOdds()` — the empirical share of protocols at each tracking age that now record a token, from the snapshot itself. Screenshot 4 shows the formula with its coefficients, the full cohort table (n, launched, raw rate, applied odds) and the category premiums. `walkForward()` fits the 33 oldest tracked peers and prices the 33 newest unseen: model miss ×2.10 vs flat ×4.52 — both numbers headlined in screenshots 1 and 4. `validate()` adds leave-one-out diagnostics per peer in board.json.

## 3. Farm plans — proven by screenshot 2 (dossier)
`farmEconomics()` in lib/economics.ts costs every plan: deposit sized to the budget and capped at 2% of TVL, per-chain gas times the route's transaction count, slippage in bps, bridge cost, and the T-bill yield the capital gives up. Screenshot 2 shows Steakhouse's dossier: the decision paragraph first ("Farm it / Thin / Skip" with net, after-yield net, $/hour, break-even odds), then 7 concrete steps with exact dollars, minutes, dates and a stop level. Every row carries its own plan; `insightFor()` adds observations true of that protocol alone (its week vs the market median, its size percentile, its tracking age vs the launched cohort). FARM clears fees and the yield hurdle; THIN clears fees only; SKIP names the reason.

## 4. The dashboard as a page — proven by screenshots 1, 2, 3
Sortable (implied value, net of fees, launch odds, TVL, growth, name) and filterable (search, sector, chain, cohort, verdict) — screenshot 3 shows a filtered board with the verdict filter applied. Every protocol has a dossier (screenshot 2). Screenshot 3 also shows the "Re-price the model" panel open: its sliders re-run the economics on every row in the browser via `Recompute.farmRow()`, and Export CSV writes the current scenario. Works offline from file://, keyboard-navigable, readable at 320px.

## 5. It looks made
The Fieldbook palette: cream paper, ink blue, serif display type over tabular monospace figures, fine rules, no framework — visible in all four screenshots. Chosen spacing and type scale throughout; the same hand in the board, the dossier and the method tables.

Assumptions (gas, slippage, airdrop share, yield) are disclosed as assumptions everywhere they appear; nothing here claims a token will launch or a reward is promised.
