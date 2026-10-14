import 'reflect-metadata';
import { readFileSync } from 'fs';

const youtubeApi = {
  playlists: { list: jest.fn(), insert: jest.fn() },
  videos: { list: jest.fn() },
  playlistItems: { list: jest.fn(), insert: jest.fn() },
  captions: { list: jest.fn(), insert: jest.fn() },
};

jest.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: jest.fn(() => ({ setCredentials: jest.fn() })) },
    youtube: jest.fn(() => youtubeApi),
    oauth2: jest.fn(),
    youtubeAnalytics: jest.fn(),
  },
}));

// eslint-disable-next-line import/first
import { YoutubeProvider } from './youtube.provider';
// eslint-disable-next-line import/first
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';

describe('YoutubeProvider playlist and captions', () => {
  const provider = new YoutubeProvider() as any;

  beforeEach(() => jest.clearAllMocks());

  it('exposes getPlaylists as an integration tool', () => {
    const tools = Reflect.getMetadata('custom:tool', YoutubeProvider.prototype);
    expect(tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ methodName: 'getPlaylists' })])
    );
  });

  it('does not insert a video already in the playlist', async () => {
    youtubeApi.playlistItems.list.mockResolvedValue({ data: { items: [{ id: 'x' }] } });
    await provider.ensurePlaylistMembership('token', 'PL1', 'vid');
    expect(youtubeApi.playlistItems.insert).not.toHaveBeenCalled();
  });

  it('inserts a missing playlist membership once', async () => {
    youtubeApi.playlistItems.list.mockResolvedValue({ data: { items: [] } });
    youtubeApi.playlistItems.insert.mockResolvedValue({ data: { id: 'item' } });
    await provider.ensurePlaylistMembership('token', 'PL1', 'vid');
    expect(youtubeApi.playlistItems.insert).toHaveBeenCalledTimes(1);
    expect(youtubeApi.playlistItems.insert.mock.calls[0][0].requestBody.snippet).toEqual({
      playlistId: 'PL1',
      resourceId: { kind: 'youtube#video', videoId: 'vid' },
    });
  });

  it('only uploads caption tracks that are not present yet', async () => {
    youtubeApi.captions.list.mockResolvedValue({
      data: { items: [{ snippet: { language: 'fr', name: '' } }] },
    });
    youtubeApi.captions.insert.mockResolvedValue({ data: { id: 'cap' } });
    await provider.ensureCaptions('token', 'vid', [
      { language: 'fr', name: '', srt: 'a' },
      { language: 'en', name: '', srt: 'b' },
    ]);
    expect(youtubeApi.captions.insert).toHaveBeenCalledTimes(1);
    expect(youtubeApi.captions.insert.mock.calls[0][0].requestBody.snippet).toMatchObject({
      videoId: 'vid',
      language: 'en',
      isDraft: false,
    });
  });

  it('rejects a playlist owned by another channel', async () => {
    youtubeApi.playlists.list.mockResolvedValue({
      data: { items: [{ id: 'PL1', snippet: { channelId: 'other' } }] },
    });
    await expect(provider.validateOwnedPlaylist('token', 'PL1', 'mine')).rejects.toThrow();
  });

  it('maps an expired token on getPlaylists to RefreshToken', async () => {
    youtubeApi.playlists.list.mockRejectedValue({ response: { status: 401, data: {} } });
    await expect(provider.getPlaylists('expired')).rejects.toBeInstanceOf(RefreshToken);
  });

  it('returns an existing playlist instead of creating a duplicate', async () => {
    youtubeApi.playlists.list.mockResolvedValue({
      data: { items: [{ id: 'PL1', snippet: { title: 'Series' }, status: { privacyStatus: 'public' } }] },
    });
    const result = await provider.createPlaylist('token', { title: ' series ' });
    expect(result).toMatchObject({ id: 'PL1', created: false });
    expect(youtubeApi.playlists.insert).not.toHaveBeenCalled();
  });

  it('creates a missing playlist once', async () => {
    youtubeApi.playlists.list.mockResolvedValue({ data: { items: [] } });
    youtubeApi.playlists.insert.mockResolvedValue({
      data: { id: 'PL2', snippet: { title: 'Series' }, status: { privacyStatus: 'public' } },
    });
    const result = await provider.createPlaylist('token', { title: 'Series', description: 'd' });
    expect(result).toMatchObject({ id: 'PL2', created: true });
    expect(youtubeApi.playlists.insert).toHaveBeenCalledTimes(1);
  });

  it('refuses backfill on a video of another channel', async () => {
    youtubeApi.videos.list.mockResolvedValue({ data: { items: [{ id: 'v', snippet: { channelId: 'other' } }] } });
    await expect(
      provider.addCaptionTrack('token', { videoId: 'v', language: 'fr', srt: 'x' }, 'mine')
    ).rejects.toThrow();
    expect(youtubeApi.captions.insert).not.toHaveBeenCalled();
  });

  it('backfills a caption track once and reports an existing one', async () => {
    youtubeApi.videos.list.mockResolvedValue({ data: { items: [{ id: 'v', snippet: { channelId: 'mine' } }] } });
    youtubeApi.captions.list.mockResolvedValueOnce({ data: { items: [] } });
    youtubeApi.captions.insert.mockResolvedValue({ data: { id: 'c' } });
    const first = await provider.addCaptionTrack('token', { videoId: 'v', language: 'fr', srt: 'x' }, 'mine');
    youtubeApi.captions.list.mockResolvedValueOnce({ data: { items: [{ snippet: { language: 'fr', name: '' } }] } });
    const second = await provider.addCaptionTrack('token', { videoId: 'v', language: 'fr', srt: 'x' }, 'mine');
    expect([first.status, second.status]).toEqual(['inserted', 'already_present']);
    expect(youtubeApi.captions.insert).toHaveBeenCalledTimes(1);
  });

  it('backfills playlist membership only for an owned playlist', async () => {
    youtubeApi.videos.list.mockResolvedValue({ data: { items: [{ id: 'v', snippet: { channelId: 'mine' } }] } });
    youtubeApi.playlists.list.mockResolvedValue({ data: { items: [{ id: 'PL', snippet: { channelId: 'mine' } }] } });
    youtubeApi.playlistItems.list.mockResolvedValue({ data: { items: [] } });
    youtubeApi.playlistItems.insert.mockResolvedValue({ data: { id: 'i' } });
    const result = await provider.addVideoToPlaylist('token', { videoId: 'v', playlistId: 'PL' }, 'mine');
    expect(result.status).toBe('inserted');
  });

  it('validates the playlist before opening the upload session', () => {
    const source = readFileSync(__filename.replace('.spec.ts', '.ts'), 'utf8');
    const pending = source.indexOf('async postPending(');
    const validation = source.indexOf('await this.validateOwnedPlaylist(', pending);
    const session = source.indexOf('upload/youtube/v3/videos?uploadType=resumable', pending);
    expect(validation).toBeGreaterThan(pending);
    expect(session).toBeGreaterThan(validation);
  });
});
