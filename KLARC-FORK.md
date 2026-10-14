# Klarc fork of Postiz

`klarc/main` = the latest upstream `gitroomhq/postiz-app` release tag (what upstream ships
as `:latest`) + a small stack of Klarc commits.
Production (Coolify, `klarc-dev/klarc-services/postiz/docker-compose.yaml`) runs
`ghcr.io/klarc-dev/postiz-app:klarc-latest`.

## What the patch adds (YouTube)

- `playlistId` (optional) in the YouTube post settings: checked against the
  connected channel before the upload starts, then the published video is added
  to the playlist. `getPlaylists` integration tool lists the channel's playlists
  (UI selector, CLI `integrations:trigger <id> getPlaylists`).
- `captions[]` (optional) `{ language, name?, srt, isDraft? }`: uploaded with
  `captions.insert` once the video exists. UI: "Subtitles" file picker.
- Both run in `finalizePost` after the thumbnail and are idempotent (existing
  playlist item or language+name track is skipped), so a retried finalize never
  duplicates anything. No new OAuth scope: `youtube.force-ssl` is already granted.

Files: `youtube.settings.dto.ts`, `youtube.provider.ts`, frontend
`youtube.playlist.tsx`, `youtube.captions.tsx`, `youtube.provider.tsx`; tests in
the two `*.spec.ts` files next to them, run by `jest.klarc.config.js`.

## Staying up to date

`.github/workflows/klarc-fork.yml` runs daily (and on demand / on push):
rebase the Klarc commits on the latest upstream release → run the patch tests → push
`klarc/main` → build and push `klarc-latest` plus `klarc-<date>-<sha>`.
On a rebase conflict it stops, opens an issue, and production keeps the last
good image. Resolve locally:

```bash
git fetch upstream --tags
git rebase --onto <latest-release-tag> "$(git merge-base HEAD upstream/main)"   # fix the YouTube files
pnpm install --frozen-lockfile --ignore-scripts && npx jest -c jest.klarc.config.js
git push --force-with-lease origin HEAD:klarc/main
```

Keep the patch small and in its own files where possible. If upstream ever
ships playlist/caption support, drop the Klarc commits instead of rebasing them.

## License

Postiz is AGPL-3.0. This fork is public, which provides the modified source to
users of the network service as the license requires.
