import 'reflect-metadata';
import { readFileSync } from 'fs';

const youtubeApi = {
  playlists: { list: jest.fn() },
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

  it('validates the playlist before opening the upload session', () => {
    const source = readFileSync(__filename.replace('.spec.ts', '.ts'), 'utf8');
    const pending = source.indexOf('async postPending(');
    const validation = source.indexOf('await this.validateOwnedPlaylist(', pending);
    const session = source.indexOf('upload/youtube/v3/videos?uploadType=resumable', pending);
    expect(validation).toBeGreaterThan(pending);
    expect(session).toBeGreaterThan(validation);
  });
});
