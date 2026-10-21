# WordPress editorial calendar rollout, 2026-10-21

## Deployed

- Candidate: `28e448ab38705247c3f2a769514ec80ba92f3961`.
- CI: https://github.com/klarc-dev/postiz/actions/runs/39633112161 succeeded, including tests and image publication.
- Coolify app: `pw0o8gcok88k84swok8kws4g`, deployment `u8boq2pe9xo7dsvqnu0fuy6l`, finished.
- Running container: `postiz-pw0o8gcok88k84swok8kws4g-20261021T162432`, healthy.
- UI version observed: `klarc-v2.25.1-28e448ab`.
- Deployed image: `ghcr.io/klarc-dev/postiz@sha256:205798e6613e0ed0b4787d5f5107d95c9a7c9a546445a39aeeae0ed7af23efb2`.
- Previous rollback image: `ghcr.io/klarc-dev/postiz@sha256:5c8f594ccdc7ef99c9a55b5406456dbd818d940c4bac6c24e314e8aab55c3b49`.

## Actual acceptance

Authenticated target organization at social.klarc.eu, 21 October calendar:

- Calendar projection: **13 successful WordPress article entries**, **1 separate failed delivery**.
- Expanded existing same-minute `Show more` controls: exactly **13 rendered history buttons**. No update deliveries masquerade as additional articles.
- WordPress-filtered published list: **13 total**, 13 returned, no further page.
- All 43 successful deliveries retained in nested history. Pillar has 5 deliveries (4 updates), D2/D3 each 4 deliveries (3 updates), other ten articles each 3 deliveries (2 updates).
- Pillar modal shows newest successful delivery first and initial publication last. Version link opened real Postiz Preview, with the correct article content and no article editing controls. Existing preview comments remain available by design.
- D2 history selects `cmvi2xilx0000ud86tbddn19a`, the later takeaway-corrected source. Opening its calendar card loads that latest content, timestamp 14:19, and `MAJ WordPress #97571`. No Delete action present in editor. No save/update submission made.
- Pillar remains anchored at its original 11:38 publication despite latest delivery at12:53. D2 remains at12:16 despite later14:19 correction.
- Desktop history and editor screenshots retained. Mobile390x844 history visually inspected, readable stacked links, scrollable history and close control. Document width390, history list310, no horizontal overflow. CDP emulation resets between CLI invocations, so mobile capture and metric assertions ran together.
- Raw public CLI post listing remains **47 all-channel jobs, 44 WordPress jobs, 43 successful,1 failed,13 distinct successful targets**. All44 WordPress job IDs exactly match the predeployment baseline. Nothing deleted or republished.

## Whole-result verification rerun

After completion, reran all9 final test suites:163 pass,1 optional skipped. Both final frontend and production backend TypeScript checks passed. Exhaustive reconciliation over all13 deployed article records verified exact raw-history ID membership, title matching latest source settings, earliest raw publication anchor, source matching latest projected creation time, and source independently matching latest raw publication time. All13 passed, with history counts5/3/3/3/3/3/3/3/3/3/3/4/4. Published-list total13 and separate failure1 also passed.

The first custom reconciliation assertion failed because its comparator assumed the raw public API included `createdAt`. It does not. Inspected actual field keys, corrected the harness to use projected creation timestamps plus independent raw publication ordering, and reran successfully. This was a harness defect, not a product failure. No changes to production implementation were needed.

## Verification and limitations

163 local tests pass,1 optional test skipped. Frontend and production backend TypeScript checks pass. Independent final review: no material blockers for28e448ab.

Initial CI39632850967 correctly blocked image publication because clean install uses `--ignore-scripts` and the new repository unit test imported an ungenerated Prisma enum.28e448ab explicitly mocks persistence enums for stubbed unit tests. Corrected CI succeeded without weakening the workflow or changing production code.

Internal published-list grouping currently loads all scoped successful rows before grouping/sorting/pagination. This is bounded functional delivery, not a scalability claim. Existing billing/scheduling occupancy counters intentionally remain raw operations. Cross-date and organization/customer isolation are unit-tested, not exercised by creating production fixtures.

Evidence contains only task-scoped IDs/counts and UI screenshots, no credentials. This evidence-only commit remains local to avoid another production image build.
