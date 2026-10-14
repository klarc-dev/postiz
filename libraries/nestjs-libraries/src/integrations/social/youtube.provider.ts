import {
  AnalyticsData,
  AuthTokenDetails,
  PendingCheckResponse,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { Integration } from '@prisma/client';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import { google, youtube_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library/build/src/auth/oauth2client';
import {
  YoutubeCaption,
  YoutubeSettingsDto,
} from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/youtube.settings.dto';
import {
  BadBody,
  RefreshToken,
  SocialAbstract,
  ValidityMedia,
  stripQuery,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import * as process from 'node:process';
import dayjs from 'dayjs';
import { createReadStream, statSync } from 'fs';
import { getSsrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { setHeartbeatDetails } from '@gitroom/nestjs-libraries/temporal/temporal.heartbeat';
import { Rules } from '@gitroom/nestjs-libraries/chat/rules.description.decorator';
import { Tool } from '@gitroom/nestjs-libraries/integrations/tool.decorator';
import { Readable } from 'stream';

const clientAndYoutube = () => {
  const client = new google.auth.OAuth2({
    clientId: process.env.YOUTUBE_CLIENT_ID,
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET,
    redirectUri: `${process.env.FRONTEND_URL}/integrations/social/youtube`,
  });

  const youtube = (newClient: OAuth2Client) =>
    google.youtube({
      version: 'v3',
      auth: newClient,
    });

  const youtubeAnalytics = (newClient: OAuth2Client) =>
    google.youtubeAnalytics({
      version: 'v2',
      auth: newClient,
    });

  const oauth2 = (newClient: OAuth2Client) =>
    google.oauth2({
      version: 'v2',
      auth: newClient,
    });

  return { client, youtube, oauth2, youtubeAnalytics };
};

@Rules(
  'YouTube must have one video attachment, it cannot be empty. Optional: playlistId (an id returned by the getPlaylists tool, never guessed from a title) adds the published video to that playlist; captions uploads SRT caption tracks once the video exists.'
)
export class YoutubeProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 200; // YouTube has strict upload quotas
  identifier = 'youtube';
  name = 'YouTube';
  isBetweenSteps = true;
  dto = YoutubeSettingsDto;
  scopes = [
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/youtube.force-ssl',
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtubepartner',
    'https://www.googleapis.com/auth/yt-analytics.readonly',
  ];

  editor = 'normal' as const;
  maxLength() {
    return 5000;
  }

  override async checkValidity(
    items: Array<ValidityMedia[]>
  ): Promise<string | true> {
    const [firstItems] = items ?? [];
    if (items?.[0]?.length !== 1) {
      return 'You need one media';
    }
    if ((firstItems?.[0]?.path?.indexOf?.('mp4') ?? -1) === -1) {
      return 'Item must be a video';
    }
    return true;
  }

  override handleErrors(body: string):
    | {
        type: 'refresh-token' | 'bad-body';
        value: string;
      }
    | undefined {
    if (body.includes('invalidTags')) {
      return {
        type: 'bad-body',
        value: 'The maximum allowed is 500 characters in total.',
      };
    }

    if (body.includes('invalidTitle')) {
      return {
        type: 'bad-body',
        value:
          'We have uploaded your video but we could not set the title. Title is too long.',
      };
    }

    if (body.includes('invalidDescription')) {
      return {
        type: 'bad-body',
        value:
          'Your video description is invalid, it may contain disallowed characters such as < or >.',
      };
    }

    if (body.includes('invalidCategoryId')) {
      return {
        type: 'bad-body',
        value: 'The selected video category is invalid.',
      };
    }

    if (body.includes('invalidPublishAt')) {
      return {
        type: 'bad-body',
        value: 'The scheduled publishing time is invalid.',
      };
    }

    if (body.includes('invalidRecordingDetails')) {
      return {
        type: 'bad-body',
        value: 'The recording details for the video are invalid.',
      };
    }

    if (body.includes('invalidVideoGameRating')) {
      return {
        type: 'bad-body',
        value: 'The video game rating is invalid.',
      };
    }

    if (body.includes('invalidFilename')) {
      return {
        type: 'bad-body',
        value: 'The video file name is invalid.',
      };
    }

    if (body.includes('defaultLanguageNotSet')) {
      return {
        type: 'bad-body',
        value:
          'We could not set the localized video details because no default language is set.',
      };
    }

    if (body.includes('invalidVideoMetadata')) {
      return {
        type: 'bad-body',
        value:
          'Some of the video details are invalid, please review the title, description and tags.',
      };
    }

    if (body.includes('mediaBodyRequired')) {
      return {
        type: 'bad-body',
        value:
          'The video file is missing or could not be read, please re-upload the video.',
      };
    }

    if (body.includes('imageFormatUnsupported')) {
      return {
        type: 'bad-body',
        value:
          'We have uploaded your video but the thumbnail format is not supported, please use JPEG or PNG.',
      };
    }

    if (body.includes('imageTooTall')) {
      return {
        type: 'bad-body',
        value:
          'We have uploaded your video but the thumbnail image is too tall.',
      };
    }

    if (body.includes('imageTooWide')) {
      return {
        type: 'bad-body',
        value:
          'We have uploaded your video but the thumbnail image is too wide.',
      };
    }

    if (body.includes('captionExists')) {
      return {
        type: 'bad-body',
        value:
          'We have uploaded your video but a caption track for this language already exists.',
      };
    }

    if (body.includes('playlistNotFound')) {
      return {
        type: 'bad-body',
        value:
          'We have uploaded your video but the selected playlist no longer exists.',
      };
    }

    if (body.includes('rateLimitExceeded')) {
      return {
        type: 'bad-body',
        value:
          'You are sending requests too quickly, please wait a little while and try again.',
      };
    }

    if (body.includes('failedPrecondition')) {
      return {
        type: 'bad-body',
        value:
          'We have uploaded your video but we could not set the thumbnail. Thumbnail size is too large.',
      };
    }

    if (body.includes('uploadLimitExceeded')) {
      return {
        type: 'bad-body',
        value:
          'You have reached your daily upload limit, please try again tomorrow.',
      };
    }

    if (body.includes('youtubeSignupRequired')) {
      return {
        type: 'bad-body',
        value:
          'You have to link your youtube account to your google account first.',
      };
    }

    if (body.includes('youtube.thumbnail')) {
      return {
        type: 'bad-body',
        value:
          'Your account is not verified, we have uploaded your video but we could not set the thumbnail. Please verify your account and try again.',
      };
    }

    if (body.includes('Unauthorized')) {
      return {
        type: 'refresh-token',
        value:
          'Token expired or invalid, please reconnect your YouTube account.',
      };
    }

    if (body.includes('UNAUTHENTICATED') || body.includes('invalid_grant')) {
      return {
        type: 'refresh-token',
        value: 'Please re-authenticate your YouTube account',
      };
    }

    return undefined;
  }

  refreshErrorMessage(err: any): string | undefined {
    const data = err?.response?.data || {};
    const text = `${data.error_subtype || ''} ${data.error_description || ''} ${
      err?.message || ''
    }`;

    if (text.includes('invalid_rapt')) {
      return `because your organization's Google Workspace session policy invalidated its access. Ask your Google Workspace admin to mark Postiz as a trusted app and turn on "Exempt trusted apps" (https://support.google.com/a/answer/9368756) to prevent this from happening again`;
    }

    return undefined;
  }

  async refreshToken(refresh_token: string): Promise<AuthTokenDetails> {
    const { client, oauth2 } = clientAndYoutube();
    client.setCredentials({ refresh_token });
    const { credentials } = await client.refreshAccessToken();
    const user = oauth2(client);
    const expiryDate = new Date(credentials.expiry_date!);
    const unixTimestamp =
      Math.floor(expiryDate.getTime() / 1000) -
      Math.floor(new Date().getTime() / 1000);

    const { data } = await user.userinfo.get();

    return {
      accessToken: credentials.access_token!,
      expiresIn: unixTimestamp!,
      refreshToken: credentials.refresh_token ?? refresh_token,
      id: data.id!,
      name: data.name!,
      picture: data?.picture || '',
      username: '',
    };
  }

  async generateAuthUrl() {
    const state = makeSecureId(7);
    const { client } = clientAndYoutube();
    return {
      url: client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        state,
        redirect_uri: `${process.env.FRONTEND_URL}/integrations/social/youtube`,
        scope: this.scopes.slice(0),
      }),
      codeVerifier: makeSecureId(11),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const { client, oauth2 } = clientAndYoutube();
    const { tokens } = await client.getToken(params.code);
    client.setCredentials(tokens);
    const { scopes } = await client.getTokenInfo(tokens.access_token!);
    this.checkScopes(this.scopes, scopes);

    const user = oauth2(client);
    const { data } = await user.userinfo.get();

    const expiryDate = new Date(tokens.expiry_date!);
    const unixTimestamp =
      Math.floor(expiryDate.getTime() / 1000) -
      Math.floor(new Date().getTime() / 1000);

    return {
      accessToken: tokens.access_token!,
      expiresIn: unixTimestamp,
      refreshToken: tokens.refresh_token!,
      id: data.id!,
      name: data.name!,
      picture: data?.picture || '',
      username: '',
    };
  }

  async pages(accessToken: string) {
    const { client, youtube } = clientAndYoutube();
    client.setCredentials({ access_token: accessToken });
    const youtubeClient = youtube(client);

    try {
      // Get all channels the user has access to
      const response = await youtubeClient.channels.list({
        part: ['snippet', 'contentDetails', 'statistics'],
        mine: true,
      });

      const channels = response.data.items || [];

      return channels.map((channel) => ({
        id: channel.id!,
        name: channel.snippet?.title || 'Unnamed Channel',
        picture: {
          data: {
            url: channel.snippet?.thumbnails?.default?.url || '',
          },
        },
        username: channel.snippet?.customUrl || '',
        subscriberCount: channel.statistics?.subscriberCount || '0',
      }));
    } catch (error) {
      console.error('Failed to fetch YouTube channels:', error);
      return [];
    }
  }

  async fetchPageInformation(accessToken: string, data: { id: string }) {
    const { client, youtube } = clientAndYoutube();
    client.setCredentials({ access_token: accessToken });
    const youtubeClient = youtube(client);

    try {
      const response = await youtubeClient.channels.list({
        part: ['snippet', 'contentDetails', 'statistics'],
        id: [data.id],
      });

      const channel = response.data.items?.[0];

      if (!channel) {
        throw new Error('Channel not found');
      }

      return {
        id: channel.id!,
        name: channel.snippet?.title || 'Unnamed Channel',
        access_token: accessToken,
        picture: channel.snippet?.thumbnails?.default?.url || '',
        username: channel.snippet?.customUrl || '',
      };
    } catch (error) {
      console.error('Failed to fetch YouTube channel information:', error);
      throw error;
    }
  }

  async reConnect(
    id: string,
    requiredId: string,
    accessToken: string
  ): Promise<Omit<AuthTokenDetails, 'refreshToken' | 'expiresIn'>> {
    const { client, youtube } = clientAndYoutube();
    client.setCredentials({ access_token: accessToken });

    // don't go through pages() here, it swallows the real Google error and an
    // empty list would be reported as a missing channel
    const { data } = await youtube(client).channels.list({
      part: ['id'],
      mine: true,
    });

    if (!(data.items || []).some((p) => p.id === requiredId)) {
      throw new Error('Channel not found');
    }

    const information = await this.fetchPageInformation(accessToken, {
      id: requiredId,
    });

    return {
      id: information.id,
      name: information.name,
      accessToken: information.access_token,
      picture: information.picture,
      username: information.username,
    };
  }

  // ---------------------------------------------------------------------------
  // RESUMABLE UPLOAD (no more videos.insert): YouTube only creates the video
  // resource when the final byte of the session is received, so a failed or
  // retried upload can never leave a video behind - and the session URI can
  // always be asked whether the video was created (the "unknown outcome" cure).
  // ---------------------------------------------------------------------------
  // YouTube requires chunk sizes to be a multiple of 256KB (except the last).
  private static readonly YOUTUBE_CHUNK_SIZE = 8 * 1024 * 1024;
  // Keep each upload batch well below the 10-minute activity timeout, the
  // workflow calls finalizePost again for the remaining bytes.
  private static readonly YOUTUBE_UPLOAD_BATCH_MS = 4 * 60 * 1000;

  // Resolves the total byte size of the media without loading it into memory:
  // a HEAD request for remote URLs, statSync for local files.
  private async youtubeMediaSize(path: string): Promise<number> {
    if (path.indexOf('http') === 0) {
      // the media path is user-influenced, keep the SSRF-safe dispatcher that
      // this.fetch applies to every other outbound request. identity encoding
      // so content-length matches the bytes a later GET actually streams
      // (fetch transparently decompresses encoded bodies).
      setHeartbeatDetails(`youtube: media size ${stripQuery(path)}`);
      const head = await fetch(path, {
        method: 'HEAD',
        headers: { 'accept-encoding': 'identity' },
        dispatcher: getSsrfSafeDispatcher(),
      } as any);
      const length = head.headers.get('content-length');
      if (!length) {
        throw new BadBody(
          this.identifier,
          '{}',
          '{}',
          'Could not determine the video size for the YouTube upload'
        );
      }
      return Number(length);
    }

    return statSync(path).size;
  }

  // Returns a streaming body for the [start, end] byte range of the media so we
  // never hold the whole file in memory: a ranged GET for remote URLs, a ranged
  // read stream for local files.
  private async youtubeChunkStream(path: string, start: number, end: number) {
    if (path.indexOf('http') === 0) {
      // identity encoding so the store keeps content-length and can answer
      // with the requested range: a transformed (compressed) response loses
      // its length, and a length-less object is answered with the full body.
      setHeartbeatDetails(
        `youtube: read media ${start}-${end} ${stripQuery(path)}`
      );
      const response = await fetch(path, {
        headers: {
          Range: `bytes=${start}-${end}`,
          'accept-encoding': 'identity',
        },
        dispatcher: getSsrfSafeDispatcher(),
      } as any);

      // A store that ignores Range (200 with the full file) or answers with an
      // error page would corrupt the upload at this offset.
      if (response.status !== 206) {
        throw new BadBody(
          this.identifier,
          '{}',
          '{}',
          'The media storage did not return the requested byte range, please try again'
        );
      }

      return response.body;
    }

    return createReadStream(path, { start, end });
  }

  // Asks the upload session for the truth: the created video when the upload
  // completed, or the exact byte offset to resume from. We use the global fetch
  // because the probe answers with 308 (Resume Incomplete), which this.fetch
  // would treat as an error.
  private async probeUploadSession(
    accessToken: string,
    uploadUri: string,
    videoSize: number
  ): Promise<{ videoId: string } | { uploadedBytes: number }> {
    setHeartbeatDetails('youtube: probe resumable session');
    const probe = await fetch(uploadUri, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Range': `bytes */${videoSize}`,
      },
    });

    if (probe.status === 200 || probe.status === 201) {
      const { id } = await probe.json();
      return { videoId: String(id) };
    }

    if (probe.status === 308) {
      const range = probe.headers.get('range');
      return {
        uploadedBytes: range ? Number(range.split('-')[1]) + 1 : 0,
      };
    }

    const text = await probe.text().catch(() => '{}');

    // Transient Google-side errors: the session stays resumable, so throw a
    // plain error - the caller treats it as "probe again later" instead of
    // permanently failing a resumable upload.
    if (probe.status === 429 || probe.status >= 500) {
      throw new Error(
        `YouTube upload status check failed with ${probe.status}`
      );
    }

    const handleError = this.handleErrors(text);

    // this.fetch has the same 401 fallback: Google 401 bodies don't always
    // match the handleErrors strings
    if (probe.status === 401 || handleError?.type === 'refresh-token') {
      throw new RefreshToken(this.identifier, text, '{}');
    }

    throw new BadBody(
      this.identifier,
      text,
      '{}',
      probe.status === 404 || probe.status === 410
        ? 'The upload session expired before the video was uploaded, please post again'
        : handleError?.value || 'Failed to check the video upload status'
    );
  }

  async postPending(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [firstPost, ...comments] = postDetails;

    const { settings }: { settings: YoutubeSettingsDto } = firstPost;
    const path = firstPost?.media?.[0]?.path!;
    if (settings?.playlistId) {
      // Fail before anything exists on the channel rather than after upload.
      await this.validateOwnedPlaylist(
        accessToken,
        settings.playlistId,
        integration.internalId
      );
    }
    const videoSize = await this.youtubeMediaSize(path);

    // Start a resumable upload session: nothing exists on the channel until
    // the final byte is received, so nothing here is irreversible yet - the
    // bytes themselves are streamed by finalizePost, outside this activity.
    const session = await this.fetch(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=id,snippet,status&notifySubscribers=true',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': 'video/mp4',
          'X-Upload-Content-Length': String(videoSize),
        },
        body: JSON.stringify({
          snippet: {
            title: settings.title,
            description: firstPost?.message,
            ...(settings?.tags?.length
              ? { tags: settings.tags.map((p) => p.label) }
              : {}),
          },
          status: {
            privacyStatus: settings.type,
            selfDeclaredMadeForKids: settings.selfDeclaredMadeForKids === 'yes',
          },
        }),
      }
    );

    const uploadUri = session.headers.get('location');
    if (!uploadUri) {
      throw new BadBody(
        this.identifier,
        '{}',
        '{}',
        'Could not start the video upload, please try again'
      );
    }

    return [
      {
        id: firstPost.id,
        releaseURL: '',
        postId: '',
        status: 'pending',
        pendingData: {
          uploadUri,
          videoSize,
          path,
          uploadedBytes: 0,
          thumbnail: settings?.thumbnail?.path || '',
          playlistId: settings?.playlistId || '',
          captions: settings?.captions || [],
        },
      },
    ];
  }

  override async checkPostStatus(
    accessToken: string,
    pendingData: {
      uploadUri: string;
      videoSize: number;
      path: string;
      uploadedBytes: number;
      thumbnail: string;
      playlistId?: string;
      captions?: YoutubeCaption[];
      videoId?: string;
    },
    integration: Integration
  ): Promise<PendingCheckResponse> {
    let probe: { videoId: string } | { uploadedBytes: number };
    try {
      probe = await this.probeUploadSession(
        accessToken,
        pendingData.uploadUri,
        pendingData.videoSize
      );
    } catch (err) {
      if (err instanceof RefreshToken || err instanceof BadBody) {
        throw err;
      }

      // transient network error, the workflow will check again
      return { status: 'pending', pendingData };
    }

    // the upload completed: the video exists, only the thumbnail, playlist and
    // captions may be left
    if ('videoId' in probe) {
      if (
        pendingData.thumbnail ||
        pendingData.playlistId ||
        pendingData.captions?.length
      ) {
        return {
          status: 'ready',
          pendingData: { ...pendingData, videoId: probe.videoId },
        };
      }

      return {
        status: 'completed',
        postId: probe.videoId,
        releaseURL: `https://www.youtube.com/watch?v=${probe.videoId}`,
      };
    }

    // bytes are still missing, finalizePost resumes from the exact offset
    return {
      status: 'ready',
      pendingData: { ...pendingData, uploadedBytes: probe.uploadedBytes },
    };
  }

  override async finalizePost(
    accessToken: string,
    pendingData: {
      uploadUri: string;
      videoSize: number;
      path: string;
      uploadedBytes: number;
      thumbnail: string;
      playlistId?: string;
      captions?: YoutubeCaption[];
      videoId?: string;
    },
    integration: Integration
  ): Promise<PendingCheckResponse> {
    let videoId = pendingData.videoId;

    if (!videoId) {
      // ask the session for the truth before sending anything - a previous
      // run may have died mid-chunk, or even completed without us knowing
      const probe = await this.probeUploadSession(
        accessToken,
        pendingData.uploadUri,
        pendingData.videoSize
      );

      if ('uploadedBytes' in probe) {
        const started = Date.now();
        let uploaded = probe.uploadedBytes;

        while (uploaded < pendingData.videoSize) {
          // batch budget exhausted: hand back to the workflow, the next
          // finalizePost resumes from the offset the session reports
          if (Date.now() - started > YoutubeProvider.YOUTUBE_UPLOAD_BATCH_MS) {
            return {
              status: 'pending',
              pendingData: { ...pendingData, uploadedBytes: uploaded },
            };
          }

          const end =
            Math.min(
              uploaded + YoutubeProvider.YOUTUBE_CHUNK_SIZE,
              pendingData.videoSize
            ) - 1;
          const body = await this.youtubeChunkStream(
            pendingData.path,
            uploaded,
            end
          );

          setHeartbeatDetails('youtube: upload chunk to google');
          const upload = await fetch(pendingData.uploadUri, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'video/mp4',
              'Content-Length': String(end - uploaded + 1),
              'Content-Range': `bytes ${uploaded}-${end}/${pendingData.videoSize}`,
            },
            body,
            // Required by undici when streaming a request body.
            duplex: 'half',
          } as any);

          // more bytes expected, resume from the offset the session reports
          if (upload.status === 308) {
            const range = upload.headers.get('range');
            if (!range) {
              // no committed range reported: don't guess the offset, let the
              // next probe find the truth
              return {
                status: 'pending',
                pendingData: { ...pendingData, uploadedBytes: uploaded },
              };
            }
            uploaded = Number(range.split('-')[1]) + 1;
            continue;
          }

          // final chunk received: the video now exists on the channel
          if (upload.status === 200 || upload.status === 201) {
            const { id } = await upload.json();
            videoId = String(id);
            break;
          }

          const text = await upload.text().catch(() => '{}');

          // Transient Google-side errors: the session stays resumable, a plain
          // error makes the workflow probe and resume instead of failing the
          // whole upload.
          if (upload.status === 429 || upload.status >= 500) {
            throw new Error(
              `YouTube chunk upload failed with ${upload.status}`
            );
          }

          const handleError = this.handleErrors(text);

          if (upload.status === 401 || handleError?.type === 'refresh-token') {
            throw new RefreshToken(this.identifier, text, '{}');
          }

          throw new BadBody(
            this.identifier,
            text,
            '{}',
            handleError?.value || 'Failed to upload the video to YouTube'
          );
        }

        if (!videoId) {
          // all bytes sent without a confirmation, the next check asks the session
          return {
            status: 'pending',
            pendingData: { ...pendingData, uploadedBytes: uploaded },
          };
        }
      } else {
        videoId = probe.videoId;
      }
    }

    if (pendingData.thumbnail) {
      const { client, youtube } = clientAndYoutube();
      client.setCredentials({ access_token: accessToken });
      const youtubeClient = youtube(client);

      await this.runInConcurrent(async () =>
        youtubeClient.thumbnails.set({
          videoId,
          media: {
            body: (
              await this.getSsrfSafeAxios()({
                url: pendingData.thumbnail,
                method: 'GET',
                responseType: 'stream',
              })
            ).data,
          },
        })
      );
    }

    // Playlist and captions run after the video exists. Both are idempotent so
    // a retried finalizePost never duplicates a playlist item or a track.
    if (pendingData.playlistId) {
      await this.ensurePlaylistMembership(
        accessToken,
        pendingData.playlistId,
        videoId
      );
    }

    if (pendingData.captions?.length) {
      await this.ensureCaptions(accessToken, videoId, pendingData.captions);
    }

    return {
      status: 'completed',
      postId: videoId,
      releaseURL: `https://www.youtube.com/watch?v=${videoId}`,
    };
  }

  @Tool({
    description:
      'List every playlist owned by the connected YouTube channel. Use the returned id as playlistId; never guess it from a title.',
    dataSchema: [],
  })
  async getPlaylists(accessToken: string) {
    const { client, youtube } = clientAndYoutube();
    client.setCredentials({ access_token: accessToken });
    const youtubeClient = youtube(client);
    const playlists: Array<{ id: string; name: string; privacy: string }> = [];
    let pageToken: string | undefined;

    do {
      const response = await this.youtubeCall(() =>
        youtubeClient.playlists.list({
          part: ['snippet', 'status'],
          mine: true,
          maxResults: 50,
          pageToken,
        })
      );

      for (const playlist of response.data.items ?? []) {
        if (playlist.id) {
          playlists.push({
            id: playlist.id,
            name: playlist.snippet?.title || 'Untitled playlist',
            privacy: playlist.status?.privacyStatus || '',
          });
        }
      }

      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);

    return playlists;
  }

  @Tool({
    description:
      'Create a playlist on the connected YouTube channel, or return the existing owned playlist with exactly this title (never creates a duplicate). Returns its id for playlistId.',
    dataSchema: [
      { key: 'title', type: 'string', description: 'Exact playlist title' },
      { key: 'description', type: 'string', description: 'Playlist description (optional)' },
      { key: 'privacy', type: 'string', description: 'public, unlisted or private; defaults to public' },
    ],
  })
  async createPlaylist(
    accessToken: string,
    data: { title?: string; description?: string; privacy?: string }
  ) {
    const title = String(data?.title || '').trim();
    if (!title) {
      throw new BadBody(this.identifier, '{}', '{}', 'A playlist title is required');
    }
    const privacy = ['public', 'unlisted', 'private'].includes(data?.privacy || '')
      ? data.privacy!
      : 'public';
    const existing = (await this.getPlaylists(accessToken)).filter(
      (playlist) => playlist.name.trim().toLowerCase() === title.toLowerCase()
    );
    if (existing.length > 1) {
      throw new BadBody(
        this.identifier,
        '{}',
        '{}',
        `Several owned playlists are titled "${title}": ${existing.map((p) => p.id).join(', ')}`
      );
    }
    if (existing.length === 1) {
      return { ...existing[0], created: false };
    }

    const { client, youtube } = clientAndYoutube();
    client.setCredentials({ access_token: accessToken });
    const response = await this.youtubeCall(() =>
      youtube(client).playlists.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: { title, description: data?.description || '' },
          status: { privacyStatus: privacy },
        },
      })
    );

    return {
      id: response.data.id!,
      name: response.data.snippet?.title || title,
      privacy: response.data.status?.privacyStatus || privacy,
      created: true,
    };
  }

  private async validateOwnedPlaylist(
    accessToken: string,
    playlistId: string,
    channelId: string
  ) {
    const { client, youtube } = clientAndYoutube();
    client.setCredentials({ access_token: accessToken });
    const response = await this.youtubeCall(() =>
      youtube(client).playlists.list({
        part: ['snippet'],
        id: [playlistId],
        maxResults: 1,
      })
    );
    const playlist = response.data.items?.[0];

    if (!playlist || playlist.snippet?.channelId !== channelId) {
      throw new BadBody(
        this.identifier,
        '{}',
        '{}',
        'The selected playlist does not exist on the connected YouTube channel. Pick it again from getPlaylists.'
      );
    }
  }

  // Direct googleapis calls: map an expired token to RefreshToken so callers
  // (tool trigger, publish workflow) refresh it and retry, and log the rest.
  private async youtubeCall<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (err: any) {
      if (err?.response?.status === 401) {
        throw new RefreshToken(
          this.identifier,
          JSON.stringify(err.response.data || {}),
          '{}'
        );
      }
      console.error('YouTube API call failed:', err?.response?.status, err?.message);
      throw err;
    }
  }

  private async ensurePlaylistMembership(
    accessToken: string,
    playlistId: string,
    videoId: string
  ) {
    const { client, youtube } = clientAndYoutube();
    client.setCredentials({ access_token: accessToken });
    const youtubeClient = youtube(client);
    const existing = await this.runInConcurrent(async () =>
      youtubeClient.playlistItems.list({
        part: ['id'],
        playlistId,
        videoId,
        maxResults: 1,
      })
    );

    if (existing.data.items?.length) {
      return;
    }

    await this.runInConcurrent(async () =>
      youtubeClient.playlistItems.insert({
        part: ['snippet'],
        requestBody: {
          snippet: {
            playlistId,
            resourceId: { kind: 'youtube#video', videoId },
          },
        },
      })
    );
  }

  private async ensureCaptions(
    accessToken: string,
    videoId: string,
    captions: YoutubeCaption[]
  ) {
    const { client, youtube } = clientAndYoutube();
    client.setCredentials({ access_token: accessToken });
    const youtubeClient = youtube(client);
    const existing = await this.runInConcurrent(async () =>
      youtubeClient.captions.list({ part: ['snippet'], videoId })
    );
    const present = new Set(
      ((existing.data.items ?? []) as youtube_v3.Schema$Caption[]).map(
        (track) => `${track.snippet?.language}|${track.snippet?.name || ''}`
      )
    );

    for (const caption of captions) {
      if (present.has(`${caption.language}|${caption.name || ''}`)) {
        continue;
      }

      await this.runInConcurrent(async () =>
        youtubeClient.captions.insert({
          part: ['snippet'],
          requestBody: {
            snippet: {
              videoId,
              language: caption.language,
              name: caption.name || '',
              isDraft: caption.isDraft ?? false,
            },
          },
          media: {
            mimeType: 'application/octet-stream',
            body: Readable.from([caption.srt]),
          },
        })
      );
    }
  }

  // Old blocking behavior, kept for workflow versions before v1.0.6 that still
  // run and don't know how to resolve a `pending` response - they upload and
  // set the thumbnail inside the activity like before.
  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [response] = await this.postPending(
      id,
      accessToken,
      postDetails,
      integration
    );

    if (response.status !== 'pending') {
      return [response];
    }

    let pendingData = response.pendingData;
    const started = Date.now();

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Cap below the 10-minute activity timeout of the old workflows using
      // this method, leaving room for one more full upload batch: failing here
      // is safe (no video exists until the upload completes and the abandoned
      // session just expires), timing the activity out is not.
      if (
        Date.now() - started >
        8 * 60 * 1000 - YoutubeProvider.YOUTUBE_UPLOAD_BATCH_MS
      ) {
        throw new BadBody(
          this.identifier,
          '{}',
          '{}',
          'The video upload took too long, please try a smaller video'
        );
      }

      const finalize = await this.finalizePost(
        accessToken,
        pendingData,
        integration
      );

      if (finalize.status === 'completed') {
        return [
          {
            id: response.id,
            releaseURL: finalize.releaseURL,
            postId: finalize.postId,
            status: 'success',
          },
        ];
      }

      pendingData = finalize.pendingData;
    }
  }

  async analytics(
    id: string,
    accessToken: string,
    date: number
  ): Promise<AnalyticsData[]> {
    try {
      const endDate = dayjs().format('YYYY-MM-DD');
      const startDate = dayjs().subtract(date, 'day').format('YYYY-MM-DD');

      const { client, youtubeAnalytics } = clientAndYoutube();
      client.setCredentials({ access_token: accessToken });

      const youtubeClient = youtubeAnalytics(client);
      const { data } = await youtubeClient.reports.query({
        ids: 'channel==MINE',
        startDate,
        endDate,
        metrics:
          'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,likes,subscribersLost',
        dimensions: 'day',
        sort: 'day',
      });

      const columns = data?.columnHeaders?.map((p) => p.name)!;
      const mappedData = data?.rows?.map((p) => {
        return columns.reduce((acc, curr, index) => {
          acc[curr!] = p[index];
          return acc;
        }, {} as any);
      });

      const acc = [] as any[];
      acc.push({
        label: 'Estimated Minutes Watched',
        data: mappedData?.map((p: any) => ({
          total: p.estimatedMinutesWatched,
          date: p.day,
        })),
      });

      acc.push({
        label: 'Average View Duration',
        average: true,
        data: mappedData?.map((p: any) => ({
          total: p.averageViewDuration,
          date: p.day,
        })),
      });

      acc.push({
        label: 'Average View Percentage',
        average: true,
        data: mappedData?.map((p: any) => ({
          total: p.averageViewPercentage,
          date: p.day,
        })),
      });

      acc.push({
        label: 'Subscribers Gained',
        data: mappedData?.map((p: any) => ({
          total: p.subscribersGained,
          date: p.day,
        })),
      });

      acc.push({
        label: 'Subscribers Lost',
        data: mappedData?.map((p: any) => ({
          total: p.subscribersLost,
          date: p.day,
        })),
      });

      acc.push({
        label: 'Likes',
        data: mappedData?.map((p: any) => ({
          total: p.likes,
          date: p.day,
        })),
      });

      return acc;
    } catch (err) {
      return [];
    }
  }

  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    date: number
  ): Promise<AnalyticsData[]> {
    const today = dayjs().format('YYYY-MM-DD');

    try {
      const { client, youtube } = clientAndYoutube();
      client.setCredentials({ access_token: accessToken });
      const youtubeClient = youtube(client);

      // Fetch video statistics
      const response = await youtubeClient.videos.list({
        part: ['statistics', 'snippet'],
        id: [postId],
      });

      const video = response.data.items?.[0];

      if (!video || !video.statistics) {
        return [];
      }

      const stats = video.statistics;
      const result: AnalyticsData[] = [];

      if (stats.viewCount !== undefined) {
        result.push({
          label: 'Views',
          percentageChange: 0,
          data: [{ total: String(stats.viewCount), date: today }],
        });
      }

      if (stats.likeCount !== undefined) {
        result.push({
          label: 'Likes',
          percentageChange: 0,
          data: [{ total: String(stats.likeCount), date: today }],
        });
      }

      if (stats.commentCount !== undefined) {
        result.push({
          label: 'Comments',
          percentageChange: 0,
          data: [{ total: String(stats.commentCount), date: today }],
        });
      }

      if (stats.favoriteCount !== undefined) {
        result.push({
          label: 'Favorites',
          percentageChange: 0,
          data: [{ total: String(stats.favoriteCount), date: today }],
        });
      }

      return result;
    } catch (err: any) {
      // Expired or revoked token, checkPostAnalytics refreshes it and retries once
      if (err?.response?.status === 401) {
        throw new RefreshToken(
          this.identifier,
          JSON.stringify(err.response.data || {}),
          '{}'
        );
      }
      console.error(
        'Error fetching YouTube post analytics:',
        err?.message || err
      );
      return [];
    }
  }
}
