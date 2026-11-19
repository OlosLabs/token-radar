# AGENTS.md — Token Radar

## Purpose and working scope
- Build the offline make.fun `token-radar-01` entry in this repository, using its sealed kit snapshot and the approved Valuation Fieldbook direction.
- Keep all entry code and final screenshots inside this directory. Preserve the original kit and design preview in their sibling locations.
- Use English for the user-facing page. The visual design is editorial cream paper, restrained ink-blue, serif headings, fine rules, and tabular market figures.
- Do not claim a token will launch, that the protocol has no token (say it has no token recorded), that a campaign exists, or that a reward is promised.

## Snapshot and model
- Read only `../kit/token-radar-01-kit/input/snapshot.json` (or the official `/input/snapshot.json` mount at grade time). Its manifest digest is `42a71213519479f3a180cc5010cbbf6bd18a2447fa0ad29e4c5122b6c9184393`.
- Never copy the synthetic design preview or invent protocol, valuation, market-cap, farm, screenshot or snapshot data. A synthetic fixture is acceptable only inside an explicitly named unit test.
- Read current official `RULES.txt`, `competition.yaml`, remote requirements and the project's `docs/PRD.md` before altering the contract/model.
- The applicable gate requires at least 100 and at most 4,000 snapshot slugs, exactly ordered positive ranks, descending unique-capable positive integer implied values, all snapshot watchlist entries, and 3–12 specific farm-step strings between 20 and 600 trimmed characters each.
- Preserve model coefficients, per-row input terms, independent-pair peer references, leave-one-out diagnostics, baseline error, bounded residual ranges and model/sample limits in the board and page. Missing growth is neutral; missing tracking date is labelled and uses its disclosed scenario proxy. The snapshot's `-1` market-cap placeholder is source data, never a positive peer observation.
- Plans are research prompts, not observed rewards. Show transaction costs, position/time, eligibility verification, condition-specific risk/exit, and explicitly leave unverifiable deployments research-only.

## Implementation and artifacts
- Root `main.ts` is a Node 22.18+, standard-library-only, deterministic entry. Preserve the kit-supplied `vendor/makefun-board.ts` bytes.
- `lib/` owns the model and row-specific plan; `dashboard/` stays static, mobile-readable, keyboard accessible, dependency-free and offline. Keep every data view consistent with `/output/board.json`.
- Use the V1 Fieldbook approach: log-scale traded-peer scatter/fit/band, model against leave-one-out baseline, nearest peer analysis, dossier, and research timeline. Add complete filters, sort, comparison, shared farming scenario, sensitivity, exclusions and data provenance.
- Treat screenshots as real output: capture the completed page with local Playwright/browser at 1440×900; board, protocol detail and a genuinely filtered result. Never reuse the starter/preview screens.
- Add meaningful tests and execute them. Run two isolated entry builds, compare every output byte and stdout, and run the official offline kit check. Validate offline references, full board and farm-plan contract, screenshot dimensions/size, and that `buildDossier` recreates exact dossier bytes.
- A source-bundle transcript may be collected only from the real local CLI-recorded agent session. Do not fabricate, edit, synthesize, or falsely claim transcripts or usage. Do not read unrelated parent system prompts as build context. Do not commit, push, submit, pay, or transact without the person's explicit final review.
- Keep edits in this repository only. Do not alter global Hermes configuration or neighboring projects.
