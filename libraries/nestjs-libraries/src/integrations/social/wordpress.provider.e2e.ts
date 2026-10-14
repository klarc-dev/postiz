/**
 * Opt-in end-to-end test of WordpressProvider.post() against a real WordPress
 * STAGING site running the Voxel addon. Never point it at production.
 *
 *   WP_E2E=1 WP_E2E_DOMAIN=https://klarc.test WP_E2E_USER=… WP_E2E_PASSWORD=… \
 *   WP_E2E_AUTHOR=<user id> [WP_E2E_TUNNEL=127.0.0.1:18443] \
 *   npx jest -c jest.klarc.config.js --testMatch '**\/wordpress.provider.e2e.ts'
 *
 * The only test seam is the network dispatcher: when WP_E2E_TUNNEL is set,
 * connections to the staging host go through that (SSH) tunnel. Production
 * keeps Postiz's SSRF-safe dispatcher; nothing here changes it.
 */
import 'reflect-metadata';
import * as tls from 'node:tls';
import { Agent } from 'undici';
import { WordpressProvider } from './wordpress.provider';

const env = process.env;
const enabled = env.WP_E2E === '1';
const domain = env.WP_E2E_DOMAIN || '';
const host = domain ? new URL(domain).hostname : '';
const [tunnelHost, tunnelPort] = (env.WP_E2E_TUNNEL || '').split(':');

if (enabled && !/\.test$/.test(host)) {
  throw new Error(`WP_E2E_DOMAIN must be a .test staging site, got ${host}`);
}

const stagingAgent = new Agent({
  connect: (opts: any, callback: any) => {
    const socket = tls.connect({
      host: tunnelHost || opts.hostname,
      port: Number(tunnelPort || opts.port || 443),
      servername: opts.hostname,
      rejectUnauthorized: false, // local staging CA
    });
    socket.once('secureConnect', () => callback(null, socket));
    socket.once('error', (error) => callback(error, null));
    return socket;
  },
});

class StagingWordpressProvider extends WordpressProvider {
  override async fetch(url: string, options: RequestInit = {}, ...rest: any[]) {
    const target = new URL(url).hostname === host ? { dispatcher: stagingAgent } : {};
    return super.fetch(url, { ...options, ...target } as any, ...rest);
  }
}

const token = Buffer.from(
  JSON.stringify({ domain, username: env.WP_E2E_USER, password: env.WP_E2E_PASSWORD })
).toString('base64');
const auth = `Basic ${Buffer.from(`${env.WP_E2E_USER}:${env.WP_E2E_PASSWORD}`).toString('base64')}`;
const created: { posts: number[]; media: number[] } = { posts: [], media: [] };

async function wp(path: string, init: RequestInit = {}) {
  const response = await fetch(`${domain}${path}`, {
    ...init,
    headers: { Authorization: auth, 'Content-Type': 'application/json', ...(init.headers || {}) },
    // @ts-ignore undici option
    dispatcher: stagingAgent,
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

const runId = `postiz-fork-e2e-${Date.now()}`;
const excerpt =
  'Ce brouillon de test vérifie que Postiz transmet l’extrait natif, le slug explicite, l’auteur et les champs Voxel à WordPress.';
const voxel = {
  h1: 'Test du fork Postiz : métadonnées natives',
  faq: [{ question: 'Le fork transmet-il la FAQ ?', answer: '<p>Oui, via voxel_fields.</p>' }],
  takeaways: [{ value: '<p>Les champs passent en REST natif.</p>' }],
  sources: [
    {
      'source-title': 'Documentation REST WordPress',
      'source-url': 'https://developer.wordpress.org/rest-api/',
      'source-author': 'WordPress',
      'source-publisher': 'WordPress.org',
    },
  ],
};

const describeE2E = enabled ? describe : describe.skip;

describeE2E('WordpressProvider.post() against WordPress staging', () => {
  jest.setTimeout(120000);
  const provider = new StagingWordpressProvider();
  const details = (settings: any, message = '<p>Corps du brouillon de test.</p>') =>
    [{ id: 'e2e', message, settings: { type: 'posts', status: 'draft', ...settings }, media: [] }] as any;

  afterAll(async () => {
    for (const id of created.posts) await wp(`/wp-json/wp/v2/posts/${id}?force=true`, { method: 'DELETE' });
    for (const id of created.media) await wp(`/wp-json/wp/v2/media/${id}?force=true`, { method: 'DELETE' });
    console.log('E2E_CREATED', JSON.stringify(created));
    await stagingAgent.close();
  });

  it('publishes excerpt, explicit slug, author, voxel_fields and featured media natively', async () => {
    const [result] = await provider.post(
      'e2e',
      token,
      details({
        title: `${runId} complet`,
        slug: `${runId}-slug-explicite`,
        excerpt,
        author: Number(env.WP_E2E_AUTHOR),
        voxel_fields: voxel,
        main_image: { id: 'img', path: env.WP_E2E_IMAGE_URL },
      }),
      {} as any
    );
    created.posts.push(Number(result.postId));
    const read = await wp(`/wp-json/wp/v2/posts/${result.postId}?context=edit`);
    expect(read.status).toBe(200);
    created.media.push(read.json.featured_media);
    expect(read.json.slug).toBe(`${runId}-slug-explicite`);
    expect(read.json.excerpt.raw).toBe(excerpt);
    expect(read.json.author).toBe(Number(env.WP_E2E_AUTHOR));
    expect(read.json.status).toBe('draft');
    expect(read.json.featured_media).toBeGreaterThan(0);
    expect(read.json.voxel_fields.h1).toBe(voxel.h1);
    expect(read.json.voxel_fields.faq).toEqual(voxel.faq);
    expect(read.json.voxel_fields.takeaways).toEqual(voxel.takeaways);
    expect(read.json.voxel_fields.sources[0]).toMatchObject(voxel.sources[0]);
    console.log('E2E_EVIDENCE', JSON.stringify({ id: read.json.id, slug: read.json.slug, author: read.json.author, excerptLength: [...read.json.excerpt.raw].length, voxelKeys: Object.keys(read.json.voxel_fields).sort() }));
  });

  it('keeps generating the slug from the title when none is given', async () => {
    const [result] = await provider.post('e2e', token, details({ title: `${runId} Slug Généré`, excerpt }), {} as any);
    created.posts.push(Number(result.postId));
    const read = await wp(`/wp-json/wp/v2/posts/${result.postId}?context=edit`);
    expect(read.json.slug).toBe(`${runId}-slug-genere`);
  });

  it('fails with the Voxel message and creates nothing when a field is invalid', async () => {
    const before = await wp(`/wp-json/wp/v2/posts?search=${runId}-invalide&status=draft&context=edit`);
    const error: any = await provider
      .post('e2e', token, details({ title: `${runId}-invalide`, excerpt, voxel_fields: { h1: 'x'.repeat(71) } }), {} as any)
      .then(() => null, (e) => e);
    expect(error).toBeTruthy();
    const message = `${error?.message || ''} ${error?.json || ''} ${JSON.stringify(error)}`;
    expect(message).toMatch(/rest_invalid|h1/);
    console.log('E2E_REJECTION', message.replace(/\s+/g, ' ').slice(0, 300));
    const after = await wp(`/wp-json/wp/v2/posts?search=${runId}-invalide&status=draft&context=edit`);
    expect(after.json.length).toBe(before.json.length);
  });

  it('never forwards settings outside the allowlist', async () => {
    const [result] = await provider.post(
      'e2e',
      token,
      details({ title: `${runId} allowlist`, excerpt, meta: { injected: 'x' }, password: 'leak', comment_status: 'open' }),
      {} as any
    );
    created.posts.push(Number(result.postId));
    const read = await wp(`/wp-json/wp/v2/posts/${result.postId}?context=edit`);
    expect(read.json.password).toBe('');
    expect(read.json.meta?.injected).toBeUndefined();
  });
});
