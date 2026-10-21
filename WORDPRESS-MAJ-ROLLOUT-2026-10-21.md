# WordPress MAJ rollout, 21 October 2026

## Release and deployment

- Source candidate: `43df33b4e5ff15949a711e0695013af1ac4a4c64`, branch `klarc/main`.
- Scoped commits: `c0e09ca0` (MAJ UI and payload), `65ca6e20` (explicit full-replacement confirmation), `6819c9e3` (single-channel local save), `43df33b4` (server stale/pending gate).
- CI: https://github.com/klarc-dev/postiz/actions/runs/39589675679, **success**. Earlier intermediate candidates were cancelled and were not deployed.
- Image version: `klarc-v2.25.1-43df33b4`.
- Immutable registry digest: `ghcr.io/klarc-dev/postiz@sha256:4ff105031d052e22322619e2743118b50fb5d87e62ece3dba6bf219f17daffbd`.
- Existing Coolify application: `pw0o8gcok88k84swok8kws4g`, `klarc-dev/klarc-services`, `/postiz`.
- Coolify deployment: `0c7iif9oywfajwbrxfdthklv`, **finished** at approximately 11:23 UTC.
- Deployed through the existing compose application. The configured `klarc-latest` digest was checked against the candidate immediately before triggering deployment, and the running container digest was checked afterward.
- No database migration, volume reset, credential change, account creation, membership change or ad hoc container replacement.

## Previous capabilities and new workflow

The provider already supported `existing_post_id` through API/CLI, checked the editable target before upload, and posted to the same WordPress ID. The editor did not expose a clear remote-update action. Generic Update could mean local Postiz details, while Republish risked creating another remote article without an explicit target.

The active, published WordPress channel now offers **MAJ WordPress #ID** on desktop and **MAJ WordPress** in mobile actions. The ID comes only from the stored published `releaseId`. The action requires explicit confirmation that it replaces remote content with the editor content. It preserves slug, native parent, status and author by omitting them. It submits one article for one channel, without recurrence or shortlinks. It creates a fresh local delivery rather than restarting the completed history row. It does not create a new remote article.

The separate local action is named **Save this channel in Postiz** and only saves the active published WordPress channel. It cannot change newly selected or sibling channel workflows. The ambiguous Post Now dropdown is hidden for a MAJ-eligible channel. A shared submission lock prevents rapid same-modal duplicate clicks.

## Server history safety

Only MAJ requests include `wordpressUpdateSource`. The server requires the source to belong to the current organization and selected integration, be published, and match the REST type and numeric remote ID. It rejects URL/parent/status/author changes, repeats, shortlinks, multiple articles and local-ID reuse.

A PostgreSQL advisory transaction lock serializes MAJ check-and-create per organization/integration. The source is rejected if a newer completed delivery for the same REST type and remote ID exists, or if a same-target update is already queued. Generation order uses `createdAt`, not locally editable `updatedAt` or minute-truncated scheduling time. Ties fail closed. Malformed stored settings fail closed with a readable error.

The existing API/CLI create/update contract without this optional marker remains unchanged. This gate covers Postiz delivery history, not out-of-band WordPress edits. MAJ is intentional full content replacement, not a merge or remote optimistic-concurrency feature.

## Observed validation

- Real fork Jest suite on Node 22: **7 suites, 152 tests passed, 1 optional external-corpus test skipped**.
- Full frontend TypeScript check passed.
- Production backend TypeScript configuration passed.
- `git diff --check` passed.
- Independent read-only review confirmed same-ID/single-channel payload, sibling-save isolation, source ownership, latest-generation and pending-target gate, and parameterized advisory lock. No remaining material blocker for the bounded history contract.
- After rollout, the running container reports `klarc-v2.25.1-43df33b4` and the exact digest above.
- All six Postiz/dependency containers report healthy. Backend, frontend and orchestrator report PM2 online with zero restarts.
- Public `/auth` returns HTTP 200.
- Browser tab 17 renders the new version string, confirming the frontend version in a real browser.

### Live negative gate acceptance

Using the existing authorized public API key after verifying the running version:

- Submitted an intentional MAJ probe for older source delivery `cmvhyjqr7000eud8wn55av8vl`, WordPress ID `2164`, integration `cmv8ayyez000hud9f24hzcs51`.
- Production returned HTTP **400**: `A newer WordPress delivery exists. Reopen the latest completed delivery before editing.`
- Delivery list before: **47**. Delivery list after: **47**. Full ID sets matched, **zero new deliveries enqueued**.
- No article write was triggered by this rejected probe.

### Actual editor acceptance boundary

The existing Firefox session is authenticated to a Klarc organization with no channels. Its only selectable organization also has no channels. An isolated Chrome session using the existing configured account through normal login succeeded with HTTP 200, but its integration list is also empty. No account, membership or password was changed and no user token was minted.

Consequently, production editor-button visibility/click/confirmation on the intended WordPress channel could not be exercised through these legitimate browser sessions. The button and payload are source/typecheck/helper-tested, the deployed frontend version is browser-observed, and the actual deployed stale-source rejection is acceptance-tested. This is **not** evidence of a successful MAJ button-driven WordPress write, nor of a live concurrent-request/pending-target stress test. A legitimate browser session with access to the existing WordPress channel is required to close that final UI acceptance boundary.

## Rollback and residual risks

- Previous running image version: `klarc-v2.25.1-2df88f8b`.
- Preserved rollback digest: `ghcr.io/klarc-dev/postiz@sha256:62772fad02597a719e4cdee73c90c62fe92f1b413c1dc46195689808a45a2dfa`.
- Roll back through the same klarc-services/Coolify compose path, pinning the previous digest, then verify version, health and workers. Rollback was not exercised.
- Advisory gating uses an additional database connection while the existing save commits a QUEUE row before unlocking. Temporal startup is fire-and-forget, not awaited under the lock. Pool-contention/concurrent-request acceptance was not run.
- Existing generic API writes without the MAJ marker do not participate in this UI history gate. Check remote state before replaying uncertain generic creates.
- This work did not modify the articles repository or alter Lucien's author ID `24`. The separate coordinator owns publication of the revised 13 articles.
