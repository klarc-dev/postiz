import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  buildWordpressPostBody,
  wordpressErrorMessage,
  WordpressProvider,
} from './wordpress.provider';
import { WordpressDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/wordpress.dto';

const base = {
  title: 'Contrat de collaboration R&D',
  type: 'posts',
  status: 'draft',
};
const errorsFor = async (value: object) =>
  (await validate(plainToInstance(WordpressDto, { ...base, ...value }))).map(
    (e) => e.property
  );

describe('WordPress settings validation', () => {
  it('keeps the new fields optional', async () => {
    expect(await errorsFor({})).toEqual([]);
  });

  it('accepts excerpt, slug, author and voxel_fields', async () => {
    expect(
      await errorsFor({
        excerpt: 'Un extrait.',
        slug: 'contrat-collaboration-rd',
        author: 12,
        existing_post_id: 42,
        parent: 7,
        voxel_fields: {
          h1: 'Titre',
          faq: [{ question: 'Q ?', answer: '<p>R.</p>' }],
        },
      })
    ).toEqual([]);
  });

  it.each([
    ['slug', { slug: 'Not A Slug' }],
    ['slug', { slug: '../etc' }],
    ['type', { type: '../pages' }],
    ['type', { type: 'pages/42' }],
    ['type', { type: 'posts?context=edit' }],
    ['type', { type: '' }],
    ['author', { author: 0 }],
    ['author', { author: 1.5 }],
    ...['existing_post_id', 'parent'].flatMap((property) =>
      [0, -1, 1.5, '42', null, Number.MAX_SAFE_INTEGER + 1].map((value) => [
        property,
        { [property]: value },
      ])
    ),
    ['voxel_fields', { voxel_fields: ['h1'] }],
    ['voxel_fields', { voxel_fields: 'h1' }],
    ['voxel_fields', { voxel_fields: { 'bad key': 1 } }],
    ['voxel_fields', { voxel_fields: { h1: 'x'.repeat(70000) } }],
  ])('rejects an unsafe %s', async (property, value) => {
    expect(await errorsFor(value)).toContain(property);
  });

  it('rejects voxel_fields nested deeper than 16 levels', async () => {
    let deep: any = 'leaf';
    for (let i = 0; i < 17; i++) deep = { n: deep };
    expect(await errorsFor({ voxel_fields: { deep } })).toContain(
      'voxel_fields'
    );
  });
});

describe('WordPress request body', () => {
  it('generates the slug from the title when none is given', () => {
    const body = buildWordpressPostBody(base as WordpressDto, '<p>Corps</p>');
    expect(body.slug).toBe('contrat-de-collaboration-randd');
    expect(body).not.toHaveProperty('excerpt');
    expect(body).not.toHaveProperty('author');
    expect(body).not.toHaveProperty('voxel_fields');
    expect(body).not.toHaveProperty('parent');
  });

  it('lets an explicit slug override the generated one and sends the new fields', () => {
    const voxel = {
      h1: 'Titre H1',
      takeaways: [{ value: '<p>À retenir.</p>' }],
    };
    const body = buildWordpressPostBody(
      {
        ...base,
        slug: 'contrat-rd',
        excerpt: '',
        author: 7,
        voxel_fields: voxel,
      } as WordpressDto,
      '<p>Corps</p>',
      42
    );
    expect(body).toEqual({
      title: base.title,
      content: '<p>Corps</p>',
      slug: 'contrat-rd',
      status: 'draft',
      featured_media: 42,
      excerpt: '',
      author: 7,
      voxel_fields: voxel,
    });
  });

  it('never forwards settings outside the allowlist', () => {
    const body = buildWordpressPostBody(
      {
        ...base,
        id: 1,
        meta: { x: 1 },
        password: 'p',
        date: 'x',
        type: 'posts',
      } as any,
      'c'
    );
    expect(Object.keys(body).sort()).toEqual([
      'content',
      'slug',
      'status',
      'title',
    ]);
  });

  it('rejects a __proto__ key in settings parsed straight from storage', () => {
    // Postiz reloads settings with JSON.parse, which keeps "__proto__" as an own key.
    const settings = JSON.parse(
      '{"title":"T","type":"posts","voxel_fields":{"h1":{"__proto__":{"x":1}}}}'
    );
    expect(() => buildWordpressPostBody(settings, 'c')).toThrow(
      /forbidden key/
    );
  });

  it('re-validates voxel_fields and author even if DTO validation was bypassed', () => {
    expect(() =>
      buildWordpressPostBody({ ...base, voxel_fields: [1] } as any, 'c')
    ).toThrow();
    expect(() =>
      buildWordpressPostBody({ ...base, author: -3 } as any, 'c')
    ).toThrow();
  });

  it('omits an update slug but forwards explicit slug and native parent', () => {
    const settings = { ...base, existing_post_id: 42, parent: 7 };
    const body = buildWordpressPostBody(settings, 'c');
    expect(body).not.toHaveProperty('slug');
    expect(body).not.toHaveProperty('existing_post_id');
    expect(body).not.toHaveProperty('voxel_fields');
    expect(body.parent).toBe(7);
    expect(
      buildWordpressPostBody({ ...settings, slug: 'explicit' }, 'c').slug
    ).toBe('explicit');
  });

  it.each(['existing_post_id', 'parent'])(
    'revalidates %s from storage',
    (property) => {
      for (const value of [
        0,
        -1,
        1.5,
        '42',
        null,
        Number.MAX_SAFE_INTEGER + 1,
      ]) {
        expect(() =>
          buildWordpressPostBody({ ...base, [property]: value } as any, 'c')
        ).toThrow(/positive WordPress post id/);
      }
    }
  );
});

describe('WordPress publishing requests', () => {
  it.each(['draft', 'private'])(
    'preserves existing %s status when update status is omitted',
    async (status) => {
      fetchMock
        .mockResolvedValueOnce(json({ id: 42, status }))
        .mockResolvedValueOnce(json({ ...remotePost, status }));
      await post({ existing_post_id: 42, status: undefined });
      expect(sentBody(1)).not.toHaveProperty('status');
      expect(sentBody(1)).not.toHaveProperty('slug');
    }
  );

  it('still sends explicit publish status for an update', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: 42, status: 'draft' }))
      .mockResolvedValueOnce(json({ ...remotePost, status: 'publish' }));
    await post({ existing_post_id: 42, status: 'publish' });
    expect(sentBody(1).status).toBe('publish');
  });

  it('still defaults a new post to publish when status is omitted', async () => {
    fetchMock.mockResolvedValueOnce(json(remotePost, 201));
    await post({ status: undefined });
    expect(sentBody(0).status).toBe('publish');
  });

  const token = Buffer.from(
    JSON.stringify({
      domain: 'https://example.com',
      username: 'user',
      password: 'secret',
    })
  ).toString('base64');
  const remotePost = { id: 42, link: 'https://example.com/article' };
  const image = {
    id: 'local-image',
    path: 'https://cdn.example.com/cover.png',
  };
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), { status });
  let provider: WordpressProvider;
  let fetchMock: jest.SpyInstance;
  const post = (settings = {}) =>
    provider.post(
      'integration',
      token,
      [
        {
          id: 'local-post',
          message: '<p>Body</p>',
          settings: { ...base, ...settings },
        },
      ] as any,
      {} as any
    );
  const sentBody = (index: number) =>
    JSON.parse(fetchMock.mock.calls[index][1].body);

  beforeEach(() => {
    provider = new WordpressProvider();
    fetchMock = jest.spyOn(provider, 'fetch');
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('creates on the collection endpoint with upstream defaults and no target read', async () => {
    fetchMock.mockResolvedValueOnce(json(remotePost, 201));
    expect(await post()).toEqual([
      {
        id: 'local-post',
        status: 'completed',
        postId: '42',
        releaseURL: remotePost.link,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://example.com/wp-json/wp/v2/posts'
    );
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(sentBody(0)).toEqual({
      title: base.title,
      content: '<p>Body</p>',
      slug: 'contrat-de-collaboration-randd',
      status: 'draft',
    });
  });

  it('reads an editable existing target and updates that same endpoint without a generated slug', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: 42 }))
      .mockResolvedValueOnce(json(remotePost));
    await post({ existing_post_id: 42, type: 'pages', parent: 7 });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://example.com/wp-json/wp/v2/pages/42?context=edit'
    );
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://example.com/wp-json/wp/v2/pages/42'
    );
    expect(fetchMock.mock.calls[1][1].method).toBe('POST');
    expect(sentBody(1).parent).toBe(7);
    for (const key of [
      'slug',
      'existing_post_id',
      'voxel_fields',
      'excerpt',
      'author',
      'featured_media',
    ]) {
      expect(sentBody(1)).not.toHaveProperty(key);
    }
  });

  it.each(['Cover description', ''])(
    'reads target before media writes and forwards alt %j via metadata POST',
    async (alt) => {
      fetchMock
        .mockResolvedValueOnce(json({ id: 42 }))
        .mockResolvedValueOnce(
          new Response('image', { headers: { 'Content-Type': 'image/png' } })
        )
        .mockResolvedValueOnce(json({ id: 99 }, 201))
        .mockResolvedValueOnce(json({ id: 99 }))
        .mockResolvedValueOnce(json(remotePost));
      await post({
        existing_post_id: 42,
        main_image: { ...image, alt },
        slug: 'explicit',
      });
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        'https://example.com/wp-json/wp/v2/posts/42?context=edit',
        image.path,
        'https://example.com/wp-json/wp/v2/media',
        'https://example.com/wp-json/wp/v2/media/99',
        'https://example.com/wp-json/wp/v2/posts/42',
      ]);
      expect(fetchMock.mock.calls[3][1].method).toBe('POST');
      expect(sentBody(3)).toEqual({ alt_text: alt });
      expect(sentBody(4)).toMatchObject({
        featured_media: 99,
        slug: 'explicit',
      });
    }
  );

  it('does not write metadata when alt is omitted', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('image'))
      .mockResolvedValueOnce(json({ id: 99 }, 201))
      .mockResolvedValueOnce(json(remotePost, 201));
    await post({ main_image: image });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sentBody(2).featured_media).toBe(99);
  });

  it.each([
    {},
    null,
    { id: 43 },
    { id: '42' },
    { code: 'rest_cannot_edit', message: 'Cannot edit this post' },
  ])(
    'rejects a malformed or wrong target before media writes: %j',
    async (target) => {
      fetchMock.mockResolvedValueOnce(json(target));
      await expect(
        post({ existing_post_id: 42, main_image: image })
      ).rejects.toMatchObject({ nonRetryable: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );

  it('surfaces a denied target read and does not upload', async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        { code: 'rest_cannot_read', message: 'Not allowed to read this post' },
        403
      )
    );
    await expect(
      post({ existing_post_id: 42, main_image: image })
    ).rejects.toThrow(/Not allowed to read/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not upload when the target read fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('read failed'));
    await expect(
      post({ existing_post_id: 42, main_image: image })
    ).rejects.toThrow('read failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not upload or submit after a failed media read', async () => {
    fetchMock.mockRejectedValueOnce(new Error('media read failed'));
    await expect(post({ main_image: image })).rejects.toThrow(
      'media read failed'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not upload an HTTP error body as the main image', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Not found', { status: 404 }));
    await expect(post({ main_image: image })).rejects.toThrow(/Could not read/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([{}, { id: 100 }])(
    'rejects malformed or wrong-id media metadata responses: %j',
    async (metadata) => {
      fetchMock
        .mockResolvedValueOnce(new Response('image'))
        .mockResolvedValueOnce(json({ id: 99 }))
        .mockResolvedValueOnce(json(metadata));
      await expect(
        post({ main_image: { ...image, alt: 'Alt' } })
      ).rejects.toMatchObject({ nonRetryable: true });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    }
  );

  it.each([
    {},
    null,
    { id: 0 },
    { id: '99' },
    { code: 'upload_error', message: 'Upload rejected' },
  ])('rejects malformed media upload responses: %j', async (media) => {
    fetchMock
      .mockResolvedValueOnce(new Response('image'))
      .mockResolvedValueOnce(json(media));
    await expect(post({ main_image: image })).rejects.toMatchObject({
      nonRetryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not submit after a failed media metadata response', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('image'))
      .mockResolvedValueOnce(json({ id: 99 }))
      .mockResolvedValueOnce(
        json({ code: 'rest_cannot_edit', message: 'Metadata denied' }, 403)
      );
    await expect(
      post({ main_image: { ...image, alt: 'Alt' } })
    ).rejects.toThrow(/Metadata denied/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    {},
    null,
    { id: 42 },
    { id: 42, link: '' },
    { id: '42', link: remotePost.link },
    { id: 42, link: 12 },
  ])('never completes a malformed post response: %j', async (response) => {
    fetchMock.mockResolvedValueOnce(json(response));
    await expect(post()).rejects.toMatchObject({ nonRetryable: true });
  });

  it('rejects invalid JSON and a different post id in the update response', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>blocked</html>'));
    await expect(post()).rejects.toThrow(/invalid JSON/);
    fetchMock
      .mockResolvedValueOnce(json({ id: 42 }))
      .mockResolvedValueOnce(json({ ...remotePost, id: 43 }));
    await expect(post({ existing_post_id: 42 })).rejects.toThrow(
      /invalid post or media response/
    );
  });

  it.each([
    { existing_post_id: 0 },
    { parent: 0 },
    { type: '../pages' },
    { existing_post_id: 42, type: '../pages' },
    { main_image: { ...image, alt: 12 } },
  ])('validates stored settings before any request: %j', async (settings) => {
    await expect(post(settings)).rejects.toMatchObject({ nonRetryable: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('WordPress errors', () => {
  it.each([
    'rest_cannot_edit',
    'rest_cannot_read',
    'rest_post_invalid_id',
    'rest_invalid_post_id',
  ])('does not retry target errors: %s', (code) => {
    expect(
      new WordpressProvider().handleErrors(
        JSON.stringify({ code, message: 'Target unavailable' })
      )
    ).toEqual({
      type: 'bad-body',
      value: expect.stringContaining('Target unavailable'),
    });
  });

  it.each([400, 401, 403, 404])(
    'makes HTTP %s target errors readable and nonretryable',
    (status) => {
      expect(
        new WordpressProvider().handleErrors('blocked', status)
      ).toMatchObject({
        type: 'bad-body',
        value: expect.stringContaining(`HTTP ${status}`),
      });
    }
  );
  it('turns a Voxel validation error into a readable message', () => {
    const message = wordpressErrorMessage(
      JSON.stringify({
        code: 'rest_invalid_voxel_fields',
        message: 'Voxel field validation failed.',
        data: { status: 400, errors: { h1: ['Too long'] } },
      })
    );
    expect(message).toContain('rest_invalid_voxel_fields');
    expect(message).toContain('h1: Too long');
  });

  it('maps rejected posts to bad-body instead of a silent success', () => {
    const provider = new WordpressProvider();
    expect(
      provider.handleErrors(
        JSON.stringify({
          code: 'rest_invalid_param',
          message: 'Invalid parameter(s): slug',
          data: { params: { slug: 'bad' } },
        })
      )
    ).toMatchObject({ type: 'bad-body' });
  });

  it('reports a WordPress fatal error with its cause and does not retry it', () => {
    const provider = new WordpressProvider();
    const body = JSON.stringify({
      code: 'internal_server_error',
      message: '<p>Il y a eu une erreur critique sur ce site.</p>',
      data: {
        status: 500,
        error: {
          type: 1,
          message:
            'Uncaught TypeError: lean_seo_flat_post_type_unique_slug(): Argument #2 ($post_id) must be of type int, null given\nStack trace...',
        },
      },
    });
    const handled = provider.handleErrors(body);
    expect(handled).toMatchObject({ type: 'bad-body' });
    expect(handled?.value).toContain('lean_seo_flat_post_type_unique_slug');
    expect(handled?.value).not.toContain('Stack trace');
  });

  it('exposes the authors and voxel field helper tools', () => {
    const tools = Reflect.getMetadata(
      'custom:tool',
      WordpressProvider.prototype
    ).map((t: any) => t.methodName);
    expect(tools).toEqual(
      expect.arrayContaining(['authorsList', 'voxelFieldsSample'])
    );
  });
});
