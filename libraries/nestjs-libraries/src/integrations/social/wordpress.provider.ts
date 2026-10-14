import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import {
  BadBody,
  SocialAbstract,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import {
  voxelFieldsProblem,
  WordpressDto,
} from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/wordpress.dto';
import slugify from 'slugify';
// import FormData from 'form-data';
import { Tool } from '@gitroom/nestjs-libraries/integrations/tool.decorator';
import { Rules } from '@gitroom/nestjs-libraries/chat/rules.description.decorator';
import { getSsrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { string } from 'yup';

const WORDPRESS_USER_AGENT = 'Postiz/1.0 (+https://postiz.com)';

/**
 * The exact JSON body sent to `POST /wp-json/wp/v2/<type>`, built from an
 * allowlist so no other setting can reach WordPress. Precedence:
 * - title, content, status, categories, tags and featured media as upstream;
 * - slug: the explicit `slug` setting wins over the slug generated from title;
 * - excerpt, author and voxel_fields are only sent when the setting is present,
 *   so an omitted value never clears what WordPress already stores.
 * voxel_fields is re-validated here (defence in depth) and sent whole, never
 * merged: the receiving Voxel adapter validates every field again.
 */
export function buildWordpressPostBody(
  settings: WordpressDto,
  content: string,
  mediaId?: string | number
) {
  const numbers = (values?: number[]) =>
    (values || []).map((value) => Number(value)).filter((value) => !isNaN(value));
  const categories = numbers(settings?.categories);
  const tags = numbers(settings?.tags);

  if (settings?.voxel_fields !== undefined) {
    const problem = voxelFieldsProblem(settings.voxel_fields);
    if (problem) {
      throw new BadBody('wordpress', '{}', '{}', problem);
    }
  }
  if (
    settings?.author !== undefined &&
    !(Number.isInteger(settings.author) && settings.author > 0)
  ) {
    throw new BadBody('wordpress', '{}', '{}', 'author must be a WordPress user id');
  }

  return {
    title: settings?.title,
    content,
    slug:
      settings?.slug ||
      slugify(settings?.title || '', { lower: true, strict: true, trim: true }),
    status: settings?.status || 'publish',
    ...(categories.length ? { categories } : {}),
    ...(tags.length ? { tags } : {}),
    ...(mediaId ? { featured_media: mediaId } : {}),
    ...(settings?.excerpt !== undefined ? { excerpt: settings.excerpt } : {}),
    ...(settings?.author !== undefined ? { author: settings.author } : {}),
    ...(settings?.voxel_fields !== undefined
      ? { voxel_fields: settings.voxel_fields }
      : {}),
  };
}

/** WordPress / Voxel REST error JSON -> one readable message, or undefined. */
export function wordpressErrorMessage(body: string): string | undefined {
  try {
    const json = JSON.parse(body);
    if (!json || typeof json.code !== 'string') {
      return undefined;
    }
    const details = [
      ...Object.entries<any>(json.data?.params || {}).map(([key, value]) => `${key}: ${value}`),
      ...(Array.isArray(json.data?.errors)
        ? json.data.errors.map((error: any) =>
            typeof error === 'string' ? error : error?.message || JSON.stringify(error)
          )
        : Object.entries<any>(json.data?.errors || {}).map(
            ([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`
          )),
    ];
    return `WordPress rejected the post (${json.code}): ${json.message || ''}${
      details.length ? ' ' + details.join('; ') : ''
    }`.slice(0, 1000);
  } catch {
    return undefined;
  }
}

@Rules(
  'WordPress publishes the content as an article: pictures go inside the content as <img src="..."> where they should appear, the src must be a picture from the media library (upload it with uploadFromUrlTool first), attachments are not published, the cover picture is the main_image setting'
)
export class WordpressProvider
  extends SocialAbstract
  implements SocialProvider
{
  identifier = 'wordpress';
  name = 'WordPress';
  isBetweenSteps = false;
  editor = 'html' as const;
  scopes = [] as string[];
  override maxConcurrentJob = 8; // WordPress sites are the customer's own servers
  dto = WordpressDto;
  maxLength() {
    return 100000;
  }

  inlineImages() {
    return true;
  }

  async generateAuthUrl() {
    const state = makeSecureId(6);
    return {
      url: state,
      codeVerifier: makeSecureId(10),
      state,
    };
  }

  async refreshToken(refreshToken: string): Promise<AuthTokenDetails> {
    return {
      refreshToken: '',
      expiresIn: 0,
      accessToken: '',
      id: '',
      name: '',
      picture: '',
      username: '',
    };
  }
  override handleErrors(
    body: string
  ):
    | { type: 'refresh-token' | 'bad-body' | 'retry'; value: string }
    | undefined {
    if (body.indexOf('rest_cannot_create') > -1) {
      return {
        type: 'bad-body',
        value: 'The connect user has insufficient permissions to create posts',
      };
    }
    if (
      /rest_invalid_param|rest_invalid_voxel_fields|rest_cannot_edit_others|rest_invalid_author|rest_post_exists|rest_invalid_content_envelope/.test(
        body
      )
    ) {
      return {
        type: 'bad-body',
        value: wordpressErrorMessage(body) || 'WordPress rejected the post',
      };
    }
    return undefined;
  }

  async customFields() {
    return [
      {
        key: 'domain',
        label: 'Domain URL',
        validation: `/^https?:\\/\\/(?:www\\.)?[\\w\\-]+(\\.[\\w\\-]+)+([\\/?#][^\\s]*)?$/`,
        type: 'text' as const,
      },
      {
        key: 'username',
        label: 'Username',
        validation: `/.+/`,
        type: 'text' as const,
      },
      {
        key: 'password',
        label: 'Password',
        validation: `/.+/`,
        type: 'password' as const,
        hint: 'Application password, create in User->Profile',
      },
    ];
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const body = JSON.parse(Buffer.from(params.code, 'base64').toString()) as {
      domain: string;
      username: string;
      password: string;
    };

    // Normalize the domain - users often paste it with surrounding whitespace
    // or a trailing slash, which would otherwise build `https://site.com//wp-json/...`.
    const domain = body.domain.trim().replace(/\/+$/, '');

    const auth = Buffer.from(`${body.username}:${body.password}`).toString(
      'base64'
    );

    // Direct fetch (not `this.fetch`) so we can branch on the HTTP status and
    // return a specific message instead of throwing a generic error.
    let response: Response;
    try {
      response = await fetch(`${domain}/wp-json/wp/v2/users/me`, {
        headers: {
          Authorization: `Basic ${auth}`,
          'User-Agent': WORDPRESS_USER_AGENT,
        },
        // @ts-ignore - undici-only option; blocks SSRF to internal IPs
        dispatcher: getSsrfSafeDispatcher(),
      });
    } catch (err) {
      // DNS failure, connection refused, TLS error, site unreachable, etc.
      console.log(err);
      return 'Could not reach your WordPress site. Check the Domain URL and that the site is publicly accessible.';
    }

    // A security plugin (e.g. Wordfence), a WAF, or the server config commonly
    // strips the Authorization header or locks down the REST API. We don't try
    // to work around that - surface a distinct, actionable message instead.
    if (!response.ok) {
      // Log what WordPress actually returned (REST errors carry a `code` and
      // `message`) so failures can be diagnosed without guessing.
      const errorBody = await response.text().catch(() => '');
      let wpCode = '';
      let wpMessage = '';
      try {
        const parsed = JSON.parse(errorBody);
        wpCode = parsed?.code || '';
        wpMessage = parsed?.message || '';
      } catch (err) {
        // Non-JSON error body (e.g. an HTML page from a security plugin).
      }
      console.log(
        `WordPress auth failed for ${domain} (HTTP ${response.status})`,
        JSON.stringify({
          code: wpCode,
          message: wpMessage,
          ...(wpCode ? {} : { body: errorBody.slice(0, 500) }),
        })
      );

      if (response.status === 401 || response.status === 403) {
        return 'WordPress rejected the login. A security plugin or server setting may be blocking the REST API or stripping the Authorization header, or the username / Application Password is incorrect.';
      }

      return `WordPress returned an unexpected error (HTTP ${response.status}). Make sure the REST API is enabled and Application Passwords are available.`;
    }

    // Even on a 200, a security plugin / maintenance page can return HTML
    // instead of JSON, which would otherwise throw on `.json()`.
    let data: any;
    try {
      data = await response.json();
    } catch (err) {
      console.log(err);
      return 'WordPress did not return a valid response. The REST API may be disabled or blocked by a security plugin.';
    }

    const { id, name, avatar_urls, code } = data || {};

    if (code) {
      return 'Invalid credentials';
    }

    const biggestImage = Object.entries(avatar_urls || {}).reduce(
      (all, current) => {
        if (all > Number(current[0])) {
          return all;
        }
        return Number(current[0]);
      },
      0
    );

    return {
      refreshToken: '',
      expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
      accessToken: params.code,
      id: body.domain + '_' + id,
      name,
      picture: avatar_urls?.[String(biggestImage)] || '',
      username: body.username,
    };
  }

  // Custom provider functions below are invoked from the backend HTTP endpoint
  // (`/integrations/function`) - which is NOT a Temporal activity - so they must
  // use a plain `fetch` (with the SSRF guard) rather than `this.fetch`, which
  // calls `Context.current()` and throws outside an activity. This mirrors how
  // `authenticate` issues its request.
  private async wpGet(token: string, path: string) {
    const body = JSON.parse(Buffer.from(token, 'base64').toString()) as {
      domain: string;
      username: string;
      password: string;
    };

    const auth = Buffer.from(`${body.username}:${body.password}`).toString(
      'base64'
    );

    const response = await fetch(`${body.domain}${path}`, {
      headers: {
        Authorization: `Basic ${auth}`,
        'User-Agent': WORDPRESS_USER_AGENT,
      },
      // @ts-ignore - undici-only option; blocks SSRF to internal IPs
      dispatcher: getSsrfSafeDispatcher(),
    });

    return response.json();
  }

  @Tool({
    description: 'Get list of post types',
    dataSchema: [],
  })
  async postTypes(token: string) {
    const postTypes = await this.wpGet(token, '/wp-json/wp/v2/types');

    return Object.entries<any>(postTypes).reduce((all, [key, value]) => {
      if (
        key.indexOf('wp_') > -1 ||
        key.indexOf('nav_') > -1 ||
        key === 'attachment'
      ) {
        return all;
      }

      all.push({
        id: value.rest_base,
        name: value.name,
      });

      return all;
    }, []);
  }

  @Tool({
    description: 'Get list of categories',
    dataSchema: [],
  })
  async categoriesList(token: string) {
    const categories = await this.wpGet(
      token,
      '/wp-json/wp/v2/categories?per_page=100'
    );

    return (Array.isArray(categories) ? categories : []).map(
      (category: any) => ({
        id: category.id,
        name: category.name,
      })
    );
  }

  @Tool({
    description: 'Get list of tags',
    dataSchema: [],
  })
  async tagsList(token: string) {
    const tags = await this.wpGet(token, '/wp-json/wp/v2/tags?per_page=100');

    return (Array.isArray(tags) ? tags : []).map((tag: any) => ({
      id: tag.id,
      name: tag.name,
    }));
  }

  @Tool({
    description:
      'List WordPress users that can be set as author (id and name). Use the id as the author setting.',
    dataSchema: [],
  })
  async authorsList(token: string) {
    const users = await this.wpGet(token, '/wp-json/wp/v2/users?per_page=100');

    return (Array.isArray(users) ? users : []).map((user: any) => ({
      id: user.id,
      name: user.name,
    }));
  }

  @Tool({
    description:
      'Show the voxel_fields keys and value shapes of the most recent post of a type (Voxel addon sites), to build a valid voxel_fields setting. Returns an empty object when the site exposes no voxel_fields.',
    dataSchema: [
      {
        key: 'type',
        type: 'string',
        description: 'WordPress REST base of the post type, e.g. posts',
      },
    ],
  })
  async voxelFieldsSample(token: string, data: { type?: string }) {
    const type = String(data?.type || 'posts');
    if (!/^[a-z0-9_-]+$/i.test(type)) {
      throw new BadBody(this.identifier, '{}', '{}', 'type must be a REST base');
    }
    const posts = await this.wpGet(
      token,
      `/wp-json/wp/v2/${type}?per_page=1&context=edit&_fields=id,voxel_fields`
    );
    const sample = Array.isArray(posts) ? posts[0] : undefined;

    return {
      type,
      postId: sample?.id ?? null,
      voxel_fields: sample?.voxel_fields ?? {},
    };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<WordpressDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const body = JSON.parse(Buffer.from(accessToken, 'base64').toString()) as {
      domain: string;
      username: string;
      password: string;
    };

    const auth = Buffer.from(`${body.username}:${body.password}`).toString(
      'base64'
    );

    // Validate before any upload, so a rejected post leaves no orphan media.
    buildWordpressPostBody(postDetails?.[0]?.settings, postDetails?.[0]?.message);

    let mediaId = '';
    if (postDetails?.[0]?.settings?.main_image?.path) {
      console.log(
        'Uploading image to WordPress',
        postDetails[0].settings.main_image.path
      );

      const blob = await this.fetch(
        postDetails[0].settings.main_image.path
      ).then((r) => r.blob());

      const mediaResponse = await (
        await this.fetch(`${body.domain}/wp-json/wp/v2/media`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Disposition': `attachment; filename="${postDetails[0].settings.main_image.path
              .split('/')
              .pop()}"`,
            'Content-Type': blob.type,
            'User-Agent': WORDPRESS_USER_AGENT,
          },
          body: blob,
        })
      ).json();

      mediaId = mediaResponse.id;
    }


    const submit = await (
      await this.fetch(
        `${body.domain}/wp-json/wp/v2/${postDetails?.[0]?.settings?.type}`,
        {
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/json',
            'User-Agent': WORDPRESS_USER_AGENT,
          },
          method: 'POST',
          body: JSON.stringify(
            buildWordpressPostBody(
              postDetails?.[0]?.settings,
              postDetails?.[0]?.message,
              mediaId
            )
          ),
        }
      )
    ).json();

    return [
      {
        id: postDetails?.[0].id,
        status: 'completed',
        postId: String(submit.id),
        releaseURL: submit.link,
      },
    ];
  }
}
