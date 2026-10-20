# Klarc fork of Postiz

`klarc/main` = the latest upstream `gitroomhq/postiz-app` release tag (what upstream ships
as `:latest`) + a small stack of Klarc commits.
Canonical repository: `klarc-dev/postiz` (standalone, not a GitHub fork, because
GitHub disables scheduled workflows on forks). Production (Coolify,
`klarc-dev/klarc-services/postiz/docker-compose.yaml`) runs
`ghcr.io/klarc-dev/postiz:klarc-latest`. The earlier fork `klarc-dev/postiz-app`
is no longer updated by CI.

## What the patch adds (YouTube)

- `playlistId` (optional) in the YouTube post settings: checked against the
  connected channel before the upload starts, then the published video is added
  to the playlist. `getPlaylists` integration tool lists the channel's playlists
  (UI selector, CLI `integrations:trigger <id> getPlaylists`), and `createPlaylist`
  creates one (or returns the existing owned playlist with that exact title).
- `captions[]` (optional) `{ language, name?, srt, isDraft? }`: uploaded with
  `captions.insert` once the video exists. UI: "Subtitles" file picker.
- Both run in `finalizePost` after the thumbnail and are idempotent (existing
  playlist item or language+name track is skipped), so a retried finalize never
  duplicates anything. No new OAuth scope: `youtube.force-ssl` is already granted.

Files: `youtube.settings.dto.ts`, `youtube.provider.ts`, frontend
`youtube.playlist.tsx`, `youtube.captions.tsx`, `youtube.provider.tsx`; tests in
the two `*.spec.ts` files next to them, run by `jest.klarc.config.js`.

## What the patch adds (WordPress)

- Optional, validated settings sent as native WordPress REST properties:
  `excerpt`, `slug` (explicit, `a-z0-9-`; replaces the slug generated from the
  title), `author` (user id, `authorsList` tool) and `voxel_fields` (Voxel addon
  sites; plain JSON object, safe keys, no `__proto__`/`constructor`/`prototype`,
  depth ≤ 16, ≤ 64 KiB, ≤ 200 fields; `voxelFieldsSample` shows a type's keys).
- The request body is built from an allowlist (`buildWordpressPostBody`): title,
  content, status, categories, tags, featured media as upstream; omitted new
  fields are not sent, so they never clear stored values; `voxel_fields` is sent
  whole and re-validated in the provider before any media upload.
- WordPress/Voxel rejections (`rest_invalid_param`, `rest_invalid_voxel_fields`,
  author errors…) fail the post with WordPress's own message.
- `existing_post_id` explicitly updates an existing article in the selected REST
  type. The editable target is read and its ID checked before uploading media.
  Omitted `slug` and `status` are preserved on updates. Creating a new article
  still defaults to publishing and generating a slug from the title.
- Optional positive `parent` is sent as WordPress's native REST property, not a
  Voxel custom field. The target type must expose this property. Never write
  derived `hierarchy-*` fields to simulate a parent.
- Cover `main_image.alt` is stored using the new attachment's `alt_text` before
  the article is submitted. Malformed responses fail instead of returning an
  undefined article ID. A later failure can still leave an uploaded attachment:
  reconcile before retrying, and never blindly replay an uncertain create.
- Shared safe article HTML preserves semantic tables, ordered lists, emphasis,
  blockquotes and headings through validation and provider formatting. Scripts,
  event handlers, styles and unsafe URL schemes remain disallowed.

Run the patch tests with Node 22 using `pnpm exec jest -c jest.klarc.config.js`.
Optionally set `POSTIZ_ARTICLE_CORPUS` to the prepared `articles-json` directory
for real-corpus fidelity checks. Those tests exercise the API validation and
HTML-provider formatting boundaries, not a live publication or browser preview.

## Staying up to date

`.github/workflows/klarc-fork.yml` runs daily (and on demand / on push):
rebase the Klarc commits on the latest upstream release → run the patch tests → push
`klarc/main` → build and push `klarc-latest` plus `klarc-<date>-<sha>`.
On a rebase conflict it stops, opens an issue, and production keeps the last
good image. The daily run is kicked by `klarc-dev/klarc-services`
(`.github/workflows/postiz-upstream-sync.yml`, 03:41 UTC, `GH_PAT`), because this
repository's own schedule did not fire; the 03:17 cron here stays as a second
chance. Production takes the new `klarc-latest` on its next Coolify redeploy
(Coolify only redeploys on changes under `klarc-services/postiz/**`). Resolve locally:

```bash
git fetch upstream --tags
git rebase --onto <latest-release-tag> "$(git merge-base HEAD upstream/main)"   # fix the YouTube files
pnpm install --frozen-lockfile --ignore-scripts && npx jest -c jest.klarc.config.js
git push --force-with-lease origin HEAD:klarc/main
```

Keep the patch small and in its own files where possible. If upstream ever
ships playlist/caption support, drop the Klarc commits instead of rebasing them.

## Operations notes

- The orchestrator now waits for Temporal before starting its workers
  (`apps/orchestrator/src/wait-for-temporal.ts`, up to `TEMPORAL_WAIT_TIMEOUT_MS`,
  default 5 min). Before that fix, after a Docker daemon restart, the orchestrator
  could start before Temporal and keep running without workers (no pollers on the `main`/`youtube`/`wordpress`
  task queues, posts stuck in QUEUE). Check with
  `temporal task-queue describe --task-queue main` in the Temporal container;
  fix with `pm2 restart orchestrator` in the Postiz container. If pm2 then loops
  on `EADDRINUSE :::3002`, an orphan orchestrator still holds the port: stop it
  (`kill -TERM <pid>` from `sh`) and pm2 recovers. Upstream behaviour, not the patch.
- klarc.com: the earlier explicit-slug fatal in Lean SEO is fixed in the live
  runtime, confirmed on 20 October 2026 by its nullable `?int` hook parameter.
  Still verify the canonical URL after every publish or update.

## License

Postiz is AGPL-3.0. This fork is public, which provides the modified source to
users of the network service as the license requires.
