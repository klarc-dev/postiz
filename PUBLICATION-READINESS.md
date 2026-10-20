# Klarc article publication readiness

Checked 20 October 2026. This is a local release plan, not evidence of deployment or publication.

## Candidate

- Repository: `klarc-dev/postiz`, branch `klarc/main`.
- Candidate: `be25c9c0869a9bfafec151013c7f05a651dee93c`.
- Connector commit: `88872fb4`.
- HTML validation and outbound formatting commit: `be25c9c0`.
- Scope: explicit existing WordPress article updates, native parent property, attachment alt metadata, response validation, safe rich article HTML and regression tests.
- No database migration or workflow/activity signature change.

## Observed verification

- Node 22 fork suite: 130 tests pass with `POSTIZ_ARTICLE_CORPUS` pointing at the 13 prepared article JSON files.
- Tests cover Nest API validation followed by the HTML formatting function used by the orchestrator. HTTP provider tests use mocked responses.
- Production-config TypeScript checks pass for backend and orchestrator.
- Independent review found no blocking correctness/security issue after fixes.
- No browser preview, real article write, image upload or production acceptance was performed.
- A broader non-build backend tsconfig check reports seven unrelated implicit-any errors. The actual production build configurations pass.

## Requirement traceability and real acceptance boundary

| Requirement / changed output | Concrete observed check | Evidence limit |
| --- | --- | --- |
| Update existing pillar rather than duplicate | `WordPress publishing requests` tests read the editable target then POST the same ID endpoint; mismatched IDs and failed reads reject before upload | Mocked HTTP responses, no real article update |
| Preserve existing slug and draft/private status | Named tests omit update slug and test both draft/private targets with no outgoing status; explicit publish is separately tested | Request contract verified, remote persistence untested |
| Retain native parent and Voxel structure | Request-body test forwards explicit parent and Voxel object; production WordPress OPTIONS exposes native parent integer | No parent write performed |
| Save cover alternative text | Named metadata tests check string and empty alt, omitted alt, mismatched media ID and metadata failure before submission | Mocked media requests, no real attachment uploaded |
| Preserve all 13 article bodies | Corpus test runs each complete original body through both real Nest ValidationPipe configurations and outbound `stripHtmlValidation('html')`, comparing canonical DOM | Local real functions, not queued Temporal execution or browser rendering |
| Do not introduce active HTML or entity-based injection | Named hostile HTML/entity tests reparse outbound content and reject scripts/events/unsafe URLs; normal/none/markdown regressions ensure new tags do not leak | Local security regression checks, no browser exploit suite |
| Keep existing integrations compatible | Existing YouTube and Temporal suites pass, production backend/orchestrator TypeScript configurations pass | No running workers restarted or exercised |
| Deploy connector and publish 13 articles | Real authenticated `postiz integrations:settings cmv8ayyez000hud9f24hzcs51` was exercised again after commits | **Blocked**: live schema reports `existing_post_id` absent, `parent` absent, `voxel_fields` present. The candidate is not deployed. No content write attempted because deployment approval and route/author decisions remain unresolved |

The local implementation is demonstrably better at the tested boundaries: it preserves the actual article DOM and expresses update/parent/alt requests that the original implementation could not. It is not evidence that the live service now satisfies publication requirements. The real authenticated interface confirms that it does not yet expose these fixes. Live acceptance must remain open until an approved rollout and controlled publication are observed.

## Existing runtime and rollback identity

Read-only Docker inspection verified the running application version is `klarc-v2.25.1-f4b7376e`, matching the original local checkout.

- Existing image ID: `sha256:486e6cfbf8db211993e4b14e278e81461aca8f7ab92f6a9485fba482b768af0e`.
- Existing registry digest: `ghcr.io/klarc-dev/postiz@sha256:91119f26e18bc3761efc9ff49e4798e98195066fd187fd8b51eb25f76e62f726`.
- Postiz is managed by Coolify using the deployment repository `klarc-dev/klarc-services`.
- Existing config/uploads are persistent mounts. Do not recreate volumes or reset the database.
- These identities are rollback references only. A rollback deployment has not been rehearsed.

## Proposed rollout, not executed

1. Obtain explicit approval for deploying this candidate to `https://social.klarc.eu`.
2. Push the scoped commits through the existing fork CI, verify tests and image build, record the resulting immutable image digest.
3. Redeploy through the established Coolify application path. Do not alter or replace production containers ad hoc.
4. Verify the running version and live WordPress settings schema exposes `existing_post_id` and `parent`.
5. Verify application health, authentication and Temporal workers before any content send. Revert through the same deployment path to the known previous image on acceptance failure.
6. Only after canonical routes and author decisions below are resolved, run a controlled publication and inspect the actual WordPress article, attachment alt, canonical URL and public rendered HTML.

## Publication decisions still unresolved

- The pillar is existing WordPress article **2164**, internal slug `guide-13`, author **24**, Lucien Trouette, parent **7304**. Update by ID and omit slug to preserve its existing canonical route.
- The 12 satellite slugs were checked against public and private WordPress statuses and do not exist.
- Their prepared routes use `/articles/<slug>`. Production `/articles` is the CPT archive, not a parent page. The live post type is hierarchical, its flat policy is disabled, and its configured default parent is **12433**, the `/blog` page. Do not assume the archive prefix overrides this parent policy.
- Do not change site-wide permalink settings or invent a page to force the prepared routes. Choose an approved parent/canonical mapping and rewrite all affected internal links consistently before sending.
- The portable source author `Klarc` does not resolve to a named WordPress user in the connected author list. Retain the pillar's existing author, but do not silently assign Lucien or a service account to new articles without editorial approval.

## Remaining operational risks

- A failed metadata or subsequent article request can leave a new attachment. Reconcile owned media before retrying.
- Generic create retries are not an upsert contract. After an uncertain outcome, inspect remote state before replaying a new article create.
- A Postiz local draft is different from a remote WordPress draft. Never requeue a completed create expecting it to promote the same remote article.
- Every future post envelope must explicitly contain boolean `shortLink: false`.
