import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  buildWordpressPostBody,
  wordpressErrorMessage,
  WordpressProvider,
} from './wordpress.provider';
import { WordpressDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/wordpress.dto';

const base = { title: 'Contrat de collaboration R&D', type: 'posts', status: 'draft' };
const errorsFor = async (value: object) =>
  (await validate(plainToInstance(WordpressDto, { ...base, ...value }))).map((e) => e.property);

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
        voxel_fields: { h1: 'Titre', faq: [{ question: 'Q ?', answer: '<p>R.</p>' }] },
      })
    ).toEqual([]);
  });

  it.each([
    ['slug', { slug: 'Not A Slug' }],
    ['slug', { slug: '../etc' }],
    ['author', { author: 0 }],
    ['author', { author: 1.5 }],
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
    expect(await errorsFor({ voxel_fields: { deep } })).toContain('voxel_fields');
  });
});

describe('WordPress request body', () => {
  it('generates the slug from the title when none is given', () => {
    const body = buildWordpressPostBody(base as WordpressDto, '<p>Corps</p>');
    expect(body.slug).toBe('contrat-de-collaboration-randd');
    expect(body).not.toHaveProperty('excerpt');
    expect(body).not.toHaveProperty('author');
    expect(body).not.toHaveProperty('voxel_fields');
  });

  it('lets an explicit slug override the generated one and sends the new fields', () => {
    const voxel = { h1: 'Titre H1', takeaways: [{ value: '<p>À retenir.</p>' }] };
    const body = buildWordpressPostBody(
      { ...base, slug: 'contrat-rd', excerpt: '', author: 7, voxel_fields: voxel } as WordpressDto,
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
      { ...base, id: 1, meta: { x: 1 }, password: 'p', date: 'x', type: 'posts' } as any,
      'c'
    );
    expect(Object.keys(body).sort()).toEqual(['content', 'slug', 'status', 'title']);
  });

  it('rejects a __proto__ key in settings parsed straight from storage', () => {
    // Postiz reloads settings with JSON.parse, which keeps "__proto__" as an own key.
    const settings = JSON.parse('{"title":"T","type":"posts","voxel_fields":{"h1":{"__proto__":{"x":1}}}}');
    expect(() => buildWordpressPostBody(settings, 'c')).toThrow(/forbidden key/);
  });

  it('re-validates voxel_fields and author even if DTO validation was bypassed', () => {
    expect(() => buildWordpressPostBody({ ...base, voxel_fields: [1] } as any, 'c')).toThrow();
    expect(() => buildWordpressPostBody({ ...base, author: -3 } as any, 'c')).toThrow();
  });
});

describe('WordPress errors', () => {
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
      provider.handleErrors(JSON.stringify({ code: 'rest_invalid_param', message: 'Invalid parameter(s): slug', data: { params: { slug: 'bad' } } }))
    ).toMatchObject({ type: 'bad-body' });
  });

  it('reports a WordPress fatal error with its cause and does not retry it', () => {
    const provider = new WordpressProvider();
    const body = JSON.stringify({
      code: 'internal_server_error',
      message: '<p>Il y a eu une erreur critique sur ce site.</p>',
      data: { status: 500, error: { type: 1, message: 'Uncaught TypeError: lean_seo_flat_post_type_unique_slug(): Argument #2 ($post_id) must be of type int, null given\nStack trace...' } },
    });
    const handled = provider.handleErrors(body);
    expect(handled).toMatchObject({ type: 'bad-body' });
    expect(handled?.value).toContain('lean_seo_flat_post_type_unique_slug');
    expect(handled?.value).not.toContain('Stack trace');
  });

  it('exposes the authors and voxel field helper tools', () => {
    const tools = Reflect.getMetadata('custom:tool', WordpressProvider.prototype).map((t: any) => t.methodName);
    expect(tools).toEqual(expect.arrayContaining(['authorsList', 'voxelFieldsSample']));
  });
});
