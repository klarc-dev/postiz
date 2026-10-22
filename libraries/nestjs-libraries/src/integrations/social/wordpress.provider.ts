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
  WordpressVoxelField,
  WordpressVoxelSchema,
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
 * - title, content, categories, tags and featured media as upstream;
 * - status defaults to publish on create, omitted on update unless supplied;
 * - slug: explicit wins, generated on create and omitted on update otherwise;
 * - excerpt, author, parent and voxel_fields are only sent when present,
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
    (values || [])
      .map((value) => Number(value))
      .filter((value) => !isNaN(value));
  const categories = numbers(settings?.categories);
  const tags = numbers(settings?.tags);

  for (const key of ['existing_post_id', 'parent'] as const) {
    if (
      settings?.[key] !== undefined &&
      !(Number.isSafeInteger(settings[key]) && settings[key] > 0)
    ) {
      throw new BadBody(
        'wordpress',
        '{}',
        '{}',
        `${key} must be a positive WordPress post id`
      );
    }
  }
  if (
    typeof settings?.type !== 'string' ||
    !/^[a-z0-9_-]+$/i.test(settings.type)
  ) {
    throw new BadBody('wordpress', '{}', '{}', 'type must be a REST base');
  }
  if (
    settings?.main_image?.alt !== undefined &&
    typeof settings.main_image.alt !== 'string'
  ) {
    throw new BadBody(
      'wordpress',
      '{}',
      '{}',
      'main_image.alt must be a string'
    );
  }

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
    throw new BadBody(
      'wordpress',
      '{}',
      '{}',
      'author must be a WordPress user id'
    );
  }

  return {
    title: settings?.title,
    content,
    ...(settings?.existing_post_id !== undefined && settings?.slug === undefined
      ? {}
      : {
          slug:
            settings?.slug ||
            slugify(settings?.title || '', {
              lower: true,
              strict: true,
              trim: true,
            }),
        }),
    ...(settings?.existing_post_id !== undefined &&
    settings?.status === undefined
      ? {}
      : { status: settings?.status || 'publish' }),
    ...(categories.length ? { categories } : {}),
    ...(tags.length ? { tags } : {}),
    ...(mediaId ? { featured_media: mediaId } : {}),
    ...(settings?.excerpt !== undefined ? { excerpt: settings.excerpt } : {}),
    ...(settings?.author !== undefined ? { author: settings.author } : {}),
    ...(settings?.parent !== undefined ? { parent: settings.parent } : {}),
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
    // A PHP fatal error (WordPress "critical error" page) carries the real
    // cause in data.error.message; surface it instead of the generic HTML.
    const fatal = json.data?.error?.message
      ? String(json.data.error.message).split('\n')[0]
      : '';
    const details = [
      ...(fatal ? [fatal] : []),
      ...Object.entries<any>(json.data?.params || {}).map(
        ([key, value]) => `${key}: ${value}`
      ),
      ...(Array.isArray(json.data?.errors)
        ? json.data.errors.map((error: any) =>
            typeof error === 'string'
              ? error
              : error?.message || JSON.stringify(error)
          )
        : Object.entries<any>(json.data?.errors || {}).map(
            ([key, value]) =>
              `${key}: ${Array.isArray(value) ? value.join(', ') : value}`
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
    body: string,
    status?: number
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
      /rest_invalid_param|rest_invalid_voxel_fields|rest_cannot_edit|rest_cannot_read|rest_post_invalid_id|rest_invalid_post_id|rest_invalid_author|rest_post_exists|rest_invalid_content_envelope|internal_server_error/.test(
        body
      )
    ) {
      return {
        type: 'bad-body',
        value: wordpressErrorMessage(body) || 'WordPress rejected the post',
      };
    }
    if (status && [400, 401, 403, 404].includes(status)) {
      return {
        type: 'bad-body',
        value:
          wordpressErrorMessage(body) ||
          `WordPress request failed (HTTP ${status}). Check the target post, REST type and connected user permissions.`,
      };
    }
    return undefined;
  }

  private async postResponse(
    response: Response,
    operation: string,
    expectedId?: number,
    requireLink = false
  ) {
    const raw = await response.text();
    let result: any;
    try {
      result = JSON.parse(raw);
    } catch {
      throw new BadBody(
        this.identifier,
        '{}',
        '{}',
        `WordPress ${operation} returned invalid JSON`
      );
    }
    if (!response.ok || result?.code) {
      throw new BadBody(
        this.identifier,
        raw,
        '{}',
        wordpressErrorMessage(raw) ||
          `WordPress ${operation} failed (HTTP ${response.status})`
      );
    }
    if (
      !Number.isSafeInteger(result?.id) ||
      result.id <= 0 ||
      (expectedId !== undefined && result.id !== expectedId) ||
      (requireLink &&
        (typeof result.link !== 'string' ||
          !/^https?:\/\/\S+$/i.test(result.link)))
    ) {
      throw new BadBody(
        this.identifier,
        raw,
        '{}',
        `WordPress ${operation} returned an invalid post or media response`
      );
    }
    return result;
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
  private async wpGet(
    token: string,
    path: string,
    discovery = false,
    allowForbidden = false
  ) {
    try {
      const body = JSON.parse(Buffer.from(token, 'base64').toString()) as {
        domain: string;
        username: string;
        password: string;
      };

      const auth = Buffer.from(`${body.username}:${body.password}`).toString(
        'base64'
      );

      const domain = discovery
        ? body.domain.trim().replace(/\/+$/, '')
        : body.domain;
      const response = await fetch(`${domain}${path}`, {
        headers: {
          Authorization: `Basic ${auth}`,
          'User-Agent': WORDPRESS_USER_AGENT,
        },
        // @ts-ignore - undici-only option; blocks SSRF to internal IPs
        dispatcher: getSsrfSafeDispatcher(),
        ...(discovery ? { redirect: 'error' as const } : {}),
      });

      if (!discovery) return response.json();
      if (allowForbidden && [401, 403].includes(response.status)) return null;
      if (!response.ok) throw new Error('HTTP failure');
      const result = await response.json();
      if (
        !result ||
        typeof result !== 'object' ||
        result.code ||
        result.error ||
        result.success === false
      ) {
        throw new Error('Invalid response');
      }
      return result;
    } catch (error) {
      if (!discovery) throw error;
      // Never expose response bodies, token contents, URLs or transport errors.
      throw new BadBody(
        this.identifier,
        '{}',
        '{}',
        'WordPress Voxel discovery failed. Check the REST API and connected user permissions.'
      );
    }
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
      throw new BadBody(
        this.identifier,
        '{}',
        '{}',
        'type must be a REST base'
      );
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

  @Tool({
    description:
      'Discover destination Voxel field definitions and optionally current post values. Values are read representations, not a write payload.',
    dataSchema: [
      {
        key: 'type',
        type: 'string',
        description: 'WordPress REST base, e.g. posts',
      },
      {
        key: 'postId',
        type: 'number',
        description: 'Optional existing post id',
      },
    ],
  })
  async voxelFieldSchema(
    token: string,
    data: { type?: string; postId?: number }
  ): Promise<WordpressVoxelSchema> {
    const fail = () => {
      throw new BadBody(
        this.identifier,
        '{}',
        '{}',
        'WordPress Voxel discovery returned an invalid schema or post response'
      );
    };
    const record = (value: unknown): value is Record<string, any> =>
      !!value && typeof value === 'object' && !Array.isArray(value);
    const safeKey = (key: unknown): key is string =>
      typeof key === 'string' &&
      /^[a-z0-9_-]+$/i.test(key) &&
      !['__proto__', 'constructor', 'prototype'].includes(key);
    const type = data?.type === undefined ? 'posts' : data.type;
    if (!safeKey(type)) {
      throw new BadBody(
        this.identifier,
        '{}',
        '{}',
        'type must be a REST base'
      );
    }
    if (
      data?.postId !== undefined &&
      !(Number.isSafeInteger(data.postId) && data.postId > 0)
    ) {
      throw new BadBody(
        this.identifier,
        '{}',
        '{}',
        'postId must be a positive WordPress post id'
      );
    }
    const types = await this.wpGet(token, '/wp-json/wp/v2/types', true);
    if (!record(types)) fail();
    const matches = Object.entries(types).filter(
      ([, entry]) =>
        record(entry) &&
        entry.rest_base === type &&
        (!entry.rest_namespace || entry.rest_namespace === 'wp/v2')
    );
    if (matches.length !== 1 || !safeKey(matches[0][0])) fail();
    const postType = matches[0][0];
    const index = await this.wpGet(token, '/wp-json/', true);
    if (
      !Array.isArray(index.namespaces) ||
      !index.namespaces.every(
        (namespace: unknown) => typeof namespace === 'string'
      )
    )
      fail();
    const result: WordpressVoxelSchema = {
      supported: false,
      type,
      postType,
      fields: [],
      configStatus: 'not_requested',
      valuesStatus: 'not_requested',
    };
    // Never follow URLs advertised by the remote index. Only a known, advertised namespace.
    if (!index.namespaces.includes('voxel-addon/v1')) return result;
    const path = `/wp-json/voxel-addon/v1/post-types/${postType}/fields`;
    const summary = await this.wpGet(token, path, true);
    if (
      !record(summary.data) &&
      !(Array.isArray(summary.data) && summary.data.length === 0)
    )
      fail();
    const normalize = (field: any, key: string): WordpressVoxelField => {
      if (
        !record(field) ||
        !safeKey(key) ||
        field.key !== key ||
        typeof field.type !== 'string' ||
        !field.type ||
        typeof field.label !== 'string' ||
        typeof field.required !== 'boolean'
      )
        fail();
      const normalized: WordpressVoxelField = {
        key,
        type: field.type,
        label: field.label,
        required: field.required,
      };
      for (const name of ['description', 'placeholder'] as const) {
        if (field[name] !== undefined && field[name] !== null) {
          if (typeof field[name] !== 'string') fail();
          normalized[name] = field[name];
        }
      }
      for (const name of ['maxlength', 'min', 'max', 'step'] as const) {
        if (field[name] !== undefined && field[name] !== null) {
          if (typeof field[name] !== 'number' || !Number.isFinite(field[name]))
            fail();
          normalized[name] = field[name];
        }
      }
      if (field.choices !== undefined && field.choices !== null) {
        if (!Array.isArray(field.choices)) fail();
        normalized.choices = field.choices.map((choice: any) => {
          if (
            !record(choice) ||
            typeof choice.value !== 'string' ||
            typeof choice.label !== 'string'
          )
            fail();
          return { value: choice.value, label: choice.label };
        });
      }
      // Defaults are metadata, not arbitrary remote objects containing private config.
      if (
        field.default === null ||
        ['string', 'boolean'].includes(typeof field.default) ||
        (typeof field.default === 'number' && Number.isFinite(field.default))
      ) {
        normalized.default = field.default;
      }
      return normalized;
    };
    result.fields = Object.entries(summary.data).map(([key, field]) =>
      normalize(field, key)
    );
    result.supported = true;
    if (result.fields.some((field) => field.type === 'repeater')) {
      const config = await this.wpGet(
        token,
        `/wp-json/voxel-addon/v1/config/post-types/${postType}/fields`,
        true,
        true
      );
      if (config === null) {
        result.configStatus = 'forbidden';
      } else {
        if (!Array.isArray(config.data)) fail();
        const children = (
          fields: unknown,
          depth: number
        ): WordpressVoxelField[] => {
          if (!Array.isArray(fields) || depth > 16) return fail();
          const keys = new Set<string>();
          return fields.map((field: any) => {
            if (!record(field) || !safeKey(field.key) || keys.has(field.key))
              fail();
            keys.add(field.key);
            const child = normalize(
              { ...field, required: field.required ?? false },
              field.key
            );
            if (field.type === 'repeater' && field.fields !== undefined) {
              child.children = children(field.fields, depth + 1);
            }
            return child;
          });
        };
        for (const field of result.fields) {
          if (field.type !== 'repeater') continue;
          const matches = config.data.filter(
            (item: any) => record(item) && item.key === field.key
          );
          if (matches.length > 1) fail();
          const definition = matches[0];
          if (definition && definition.type !== field.type) fail();
          if (definition?.fields !== undefined)
            field.children = children(definition.fields, 1);
        }
        result.configStatus = 'loaded';
      }
    }
    if (data?.postId !== undefined) {
      const post = await this.wpGet(
        token,
        `/wp-json/wp/v2/${type}/${data.postId}?context=edit&_fields=id,voxel_fields`,
        true
      );
      const emptyValues =
        Array.isArray(post.voxel_fields) && post.voxel_fields.length === 0;
      if (
        post.id !== data.postId ||
        (!record(post.voxel_fields) && !emptyValues)
      )
        fail();
      // Preserve unknown field values verbatim. The editor must not send these back automatically.
      result.values = emptyValues ? {} : post.voxel_fields;
      result.valuesStatus = 'loaded';
    }
    return result;
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
    buildWordpressPostBody(
      postDetails?.[0]?.settings,
      postDetails?.[0]?.message
    );

    const settings = postDetails[0].settings;
    const existingId = settings.existing_post_id;
    const postUrl = `${body.domain}/wp-json/wp/v2/${settings.type}${
      existingId !== undefined ? `/${existingId}` : ''
    }`;
    if (existingId !== undefined) {
      // Check the editable target before uploading or changing any media.
      await this.postResponse(
        await this.fetch(
          `${postUrl}?context=edit`,
          {
            method: 'GET',
            headers: {
              Authorization: `Basic ${auth}`,
              'User-Agent': WORDPRESS_USER_AGENT,
            },
          },
          this.identifier
        ),
        'update target read',
        existingId
      );
    }

    let mediaId: number | undefined;
    if (postDetails?.[0]?.settings?.main_image?.path) {
      console.log(
        'Uploading image to WordPress',
        postDetails[0].settings.main_image.path
      );

      const imageResponse = await this.fetch(settings.main_image.path);
      if (!imageResponse.ok) {
        throw new BadBody(
          this.identifier,
          '{}',
          '{}',
          'Could not read the WordPress main image'
        );
      }
      const blob = await imageResponse.blob();

      const mediaResponse = await this.postResponse(
        await this.fetch(
          `${body.domain}/wp-json/wp/v2/media`,
          {
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
          },
          this.identifier
        ),
        'media upload'
      );

      mediaId = mediaResponse.id;
      if (settings.main_image.alt !== undefined) {
        await this.postResponse(
          await this.fetch(
            `${body.domain}/wp-json/wp/v2/media/${mediaId}`,
            {
              method: 'POST',
              headers: {
                Authorization: `Basic ${auth}`,
                'Content-Type': 'application/json',
                'User-Agent': WORDPRESS_USER_AGENT,
              },
              body: JSON.stringify({ alt_text: settings.main_image.alt }),
            },
            this.identifier
          ),
          'media metadata update',
          mediaId
        );
      }
    }
    const submit = await this.postResponse(
      await this.fetch(
        postUrl,
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
        },
        this.identifier
      ),
      existingId !== undefined ? 'post update' : 'post create',
      existingId,
      true
    );

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
