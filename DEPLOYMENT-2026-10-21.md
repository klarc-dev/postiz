# Postiz deployment, 21 October 2026

## Delivered

- Fork revision: `2df88f8bb81de9bc184cf958211861216ec3bac3`.
- CI: https://github.com/klarc-dev/postiz/actions/runs/39558069046, success for tests and image build.
- Image version: `klarc-v2.25.1-2df88f8b`.
- Registry digest: `sha256:62772fad02597a719e4cdee73c90c62fe92f1b413c1dc46195689808a45a2dfa`.
- Existing Coolify application: `pw0o8gcok88k84swok8kws4g`, Postiz, social.klarc.eu.
- Coolify deployment: `si7cvzlmsygjw8dvjmfcig4a`, finished.
- Deployed through the existing klarc-services `/postiz` compose application. No database migration, volume reset, direct container replacement or credential creation.

## Observed acceptance

After the final container replacement and warmup:

- Running application version is `klarc-v2.25.1-2df88f8b`.
- All six Postiz application/dependency containers report healthy.
- Backend, frontend and orchestrator report PM2 online with zero restarts.
- Public `/auth` returns HTTP200. A transient503 during compose warmup was observed and then cleared.
- The real authenticated WordPress integration settings API exposes integer `existing_post_id` and `parent`, unlike before deployment. Voxel settings remain available.
- Temporal wordpress queue has an activity poller, main queue has workflow/activity pollers, both report zero backlog.
- Previous image remains the recorded rollback reference in PUBLICATION-READINESS.md. Rollback was not exercised.

## Cluster semantics clarified by user

Omit `parent` when no explicit parent is requested so WordPress applies its own configuration. This is not a deployment blocker.
For explicit cluster relationships, resolve actual WordPress IDs before sending dependent articles. Keep a durable mapping from local content ID to WordPress ID and public canonical URL. Reuse existing pillar ID2164 through `existing_post_id`, do not recreate it. Set child `parent` to its actual resolved parent ID, not a local placeholder or Postiz row ID. Read back the resulting relationships and URLs before finalizing internal links.

## Not yet exercised

No image upload, article create/update, draft or publication was sent in this rollout. The live schema and worker health verify deployment readiness, not the correctness of a real article mutation. Article author resolution, final dependency map and content publication acceptance remain separate work. The earlier PUBLICATION-READINESS.md records historical pre-deployment evidence and blockers and must not be read as current deployment status.
