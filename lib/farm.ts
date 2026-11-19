import type { Protocol } from './model.ts';

// Category labels support research questions, never a claim about a deployment.
const routes: Record<string, [string, string]> = {
  'Risk Curators': ['Identify a vault explicitly naming this curator; record its manager, asset, market caps and underlying exposures.', 'Request a full vault redemption quote; check idle liquidity, queues and whether incentives name the curator or only the vault.'],
  'Onchain Capital Allocator': ['Identify the allocator, vault contract, deposit asset, share accounting and managed strategies.', 'Check request, settlement and claim stages; quote all shares back to the original asset and record any queue.'],
  Lending: ['Identify a supply market, asset, supply cap and utilization; simulate supply only, with no borrowing or collateral activation.', 'Quote withdrawal against available cash; skip if liquidity cannot cover the test position without borrowing.'],
  Dexs: ['Identify the pool contract, both assets, fees and position type; simulate both entry legs and record price exposure.', 'Quote removing the full position and converting both legs back; include slippage and divergence loss in the decision.'],
  CDP: ['Check collateral types, minimum debt and liquidation terms; ask whether idle collateral alone can qualify.', 'Skip if debt is required for this research route; otherwise simulate withdrawing idle collateral with no outstanding obligation.'],
  'CDP Manager': ['Identify the managed collateral position, permissions, debt requirements and liquidation exposure before quoting any action.', 'Quote repayment and collateral release together if debt exists; skip if a debt-free reversible test is unavailable.'],
  RWA: ['Check permitted jurisdiction, investor whitelist, subscription asset and minimum before considering any subscription.', 'Verify redemption window, notice, settlement asset and fees; skip if the minimum or settlement exceeds the assumed budget or hold.'],
  Yield: ['Identify the yield instrument, underlying asset, source of return, fees and deposit/share contract.', 'Quote full redemption, lock duration and liquidity; skip if the yield depends on an exposure you cannot measure.'],
  'Basis Trading': ['Identify custody, collateral, hedge counterparties and the instrument actually received; do not infer a neutral exposure from the sector name.', 'Verify hedge unwind, redemption notice and settlement asset; skip if the full position cannot be independently reconciled.'],
  'Prediction Market': ['Check jurisdiction and whether a documented non-trading action qualifies; do not open a directional bet for an assumed reward.', 'Verify collateral recovery and unresolved-market restrictions; skip if qualifying requires an unbounded or unsettled position.'],
  Restaking: ['Identify collateral, operator, slashable exposure and the exact delegation or vault contract before simulating.', 'Verify unbonding epochs, slashing during exit and claim stages; skip if the release date or maximum loss is unknown.'],
  'Collateral Markets': ['Identify collateral, market participants, slashable exposure and whether a passive action is supported.', 'Verify withdrawal epochs and any continuing obligations; skip if a quote cannot establish when all collateral is released.'],
  Payments: ['Identify the documented payment or liquidity action and its counterparties; ask whether any reversible read-only simulation exists.', 'Verify settlement finality and a complete recovery path; skip if completing the action requires an irreversible transfer.'],
  Chain: ['Identify an actual application and qualifying action on the recorded chain; a chain label alone provides no deposit route.', 'Verify the application exit and any bridge dependencies; skip if the asset cannot return without an unverified bridge.'],
  Insurance: ['Identify the cover instrument, premium, coverage period, exclusions and whether passive participation can qualify.', 'Verify cancellation, expiry and claim restrictions; skip if capital or premium is unrecoverable under the test assumptions.'],
  CeDeFi: ['Identify custodian, deposit asset, account restrictions and offchain counterparties; verify who controls withdrawals.', 'Check withdrawal approval, settlement delays and asset conversion; skip if recovery depends on undisclosed discretion.'],
  'Governance Incentives': ['Find the exact voting, delegation or locking action and the rules that name eligible participants.', 'Check unlock dates and delegation revocation; skip if a lock exceeds the hold or reward qualification requires an unknown token.'],
  'Staking Pool': ['Identify the pool, stake asset, validator exposure and receipt mechanics; the category alone does not verify them.', 'Verify unstake, unbonding and claim stages; skip if withdrawal timing or penalties cannot be established.'],
  'Stablecoin Wrapper': ['Identify underlying backing, wrapper shares, issuer permissions and deposit/redeem accounting.', 'Quote unwrapping and redemption into the original asset; skip if backing or redemption rights cannot be verified.'],
};
const fallback: [string, string] = ['Find a documented action, contract, asset, permissions and position receipt for this exact protocol before simulating.', 'Verify full recovery into the original asset, settlement delays and all fees; skip if no reversible route is documented.'];
const questions: Record<string, string> = {
  'bittensor-dtao': 'The snapshot labels this Dexs on Bittensor. Verify whether ordinary pool entry and exit concepts apply at all; skip the LP hypothesis until documented.',
  'lightning-network': 'The snapshot labels this Payments on Bitcoin. Identify whether the action requires node or channel infrastructure; skip if that requirement cannot be budgeted and closed.',
  usdd: 'The snapshot name is USDD in CDP. Verify asset identity separately from the absence of recorded token metadata; do not infer a future issuance.',
  'reti-pooling': 'The watchlist includes this Staking Pool on Algorand. Preserve that membership while independently checking stake-asset and token identity.',
  saturn: 'The watchlist includes this Stablecoin Wrapper. Verify underlying and receipt-token identity before interpreting the missing token record.',
};

export function validatePlan(slug: string, steps: string[]) {
  if (steps.length < 3 || steps.length > 12 || steps.some(step => typeof step !== 'string' || step.trim().length < 20 || step.trim().length > 600)) {
    throw new Error(`Farm plan is outside the gate bounds: ${slug}`);
  }
}

export function farmPlan(p: Protocol, age: number | null) {
  const chain = [...p.chains].sort()[0] ?? 'Unreported chain';
  const [action, exit] = routes[p.category ?? ''] ?? fallback;
  const gate = p.change_7d === null ? 'Weekly TVL change is unreported; require a fresh liquidity check.' :
    p.change_7d < -8 ? `Snapshot weekly TVL changed ${p.change_7d}%; pause until the outflow and exit liquidity are explained.` :
    p.change_7d > 20 ? `Snapshot weekly TVL changed ${p.change_7d}%; check for temporary inflows or migration before proceeding.` :
    `Snapshot weekly TVL changed ${p.change_7d}%; recheck if current TVL falls over 10% or the exit quote worsens.`;
  const steps = [
    { title: 'Identify the record', when: 'Day 0', time: '5–10 min', cost: '$0 read-only', action: `${p.name} (${p.slug}): snapshot sector ${p.category ?? 'unreported'}, TVL $${p.tvl_usd.toLocaleString('en-US')}. ${p.chains.length ? `Start research on recorded chain ${chain}; ${p.chains.length} chain(s) recorded.` : 'No chain is recorded; skip deployment work until independently verified.'} A recorded chain is not a verified deployment or asset.` },
    { title: 'Verify eligibility', when: 'Day 0', time: '10–15 min', cost: '$0 read-only', action: `Research only: eligibility, deployment and exit are unknown for ${p.slug}. Find dated official terms naming the contract, action, asset, participant restrictions and cutoff. ${questions[p.slug] ?? 'Skip allocating capital if any requirement is absent or contradicts this record.'}` },
    { title: 'Simulate the route', when: 'Day 0', time: '10–20 min', cost: '$0; no funds deployed', action: `Category-based hypothesis for ${p.name}: ${action} Save a read-only quote with contract and asset identifiers. This snapshot supplies neither; skip any signature or deposit while those identifiers remain unverified.` },
    { title: 'Budget both directions', when: 'Before any allocation', time: '10–15 min', cost: '$0 research; fees unknown', action: `Keep ${p.slug} research-only. If later verified, quote entry, exit, approvals, slippage and bridge costs together; compare with the shared capital and hold assumptions. Skip if minimum size exceeds capital, exit exceeds hold, or expected payout cannot cover fees and alternative yield.` },
    { title: 'Review exposure', when: 'Weekly during assumed hold', time: '5 min per review', cost: '$0 read-only', action: `${p.name}: ${gate} ${age === null ? 'Tracking date is unreported; the valuation uses a disclosed age proxy.' : `The record has ${age} tracking days, which does not establish launch history.`} Stop research if terms or asset identity change; do not transact to chase an unannounced reward.` },
    { title: 'Prove exit or skip', when: 'Before entry; at assumed hold end', time: '10–15 min plus unknown settlement', cost: '$0 research; exit fee unverified', action: `${p.name}: ${exit} Save request and claim dates plus the round-trip quote. Until that proof and eligibility exist, close this review without a position; reopen only after all three unknowns are resolved.` },
  ];
  const farm_steps = steps.map(s => `${s.title} (${s.when}; ${s.time}; ${s.cost}): ${s.action}`);
  validatePlan(p.slug, farm_steps);
  return { title: 'Research only', chain, research: true, fixed: 0, bps: 0,
    evidence: { basis: 'Sealed snapshot; category-based questions only', deployment: 'unknown', asset: 'unknown', eligibility: 'unknown', exit: 'unknown' }, steps };
}
