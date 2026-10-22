# Destination-aware Voxel fields acceptance

Verified 2026-10-22 against https://social.klarc.eu.

## Deployment
- Source: e58c27c06b9cbb75ceef24d3455173cc9af0afee, backend prerequisite 4a7b295e.
- CI: https://github.com/klarc-dev/postiz/actions/runs/39754570781, successful.
- Coolify deployment: v8ddkhwzisin1geswo7avlar, finished.
- UI version: klarc-v2.25.1-e58c27c0.
- Container: 08737f50ad42, healthy. Supporting containers healthy.
- Running image ID: sha256:aac31cb6031af271221b4371587bc95fbcab6af318315315a407b0e8aabc30cc.
- Published digest: ghcr.io/klarc-dev/postiz@sha256:73aa102936f7aa77213748e96ae34073ffae20f3c397ce0a41b6902b8e86ad6a.
- Previous rollback digest: ghcr.io/klarc-dev/postiz@sha256:205798e6613e0ed0b4787d5f5107d95c9a7c9a546445a39aeeae0ed7af23efb2.

## Live acceptance
- Opened historical article WordPress #97571 from calendar. Editor retained MAJ WordPress #97571.
- Authenticated Postiz voxelFieldSchema function returned HTTP 201, supported true, posts mapped to post, configStatus loaded, valuesStatus loaded.
- Actual destination field labels and controls rendered. Old optional JSON editor absent.
- Actual Main Heading value loaded. Sources contained two remote rows and Points clés five populated textarea rows. FAQ is empty on this article, correctly displayed Add FAQ rather than invented rows.
- Clicked Add Points clés, observed six rows and unchanged first existing value, then Remove Points clés 6 restored five rows. No save, update, publish or draft submission was performed.
- Desktop screenshot visually reviewed. Mobile 390x844 settings sheet visually reviewed after animation settled. Viewport and document scroll width both390, field section358px. Existing takeaways readable, controls and Done accessible.
- A subsequent authenticated read confirmed remote sources2, takeaways5 and FAQ0. Unsaved editor state discarded by reload, managed QA browser space closed.
- See desktop-fields.png, mobile-fields.png and sanitized schema-summary.json.

## Validation and review
- Final local suite:225 tests passed,1 optional skipped,10 suites. Frontend and backend production TypeScript passed.
- Independent reviewer accepted recorded-target fix and found no remaining confirmed material/security blockers. Reviewer independently ran147 focused tests and diff checks.
- Historical records without existing_post_id are covered by a real ExistingDataContext regression. Read target is derived using the same recorded WordPress identity as MAJ, without injecting write settings.

## Explicit limits
- Media, taxonomy and relation destination pickers are not implemented. Such custom fields remain explicitly read-only and preserved. Existing native cover/core controls are separate.
- Unsupported custom types and repeaters without authoritative child definitions remain read-only and preserved.
- Rich recursive config requires destination permission. This actual connection loaded config successfully. Lower-privilege connections were covered by mocked forbidden-response tests, not new production accounts.
- No production article write was attempted. Persistence and sparse mutation behavior are test-verified, not claimed as a live publish acceptance.
- Deferred-fetch and recursive enriched-value test expansion remain nonblocking review follow-ups.
