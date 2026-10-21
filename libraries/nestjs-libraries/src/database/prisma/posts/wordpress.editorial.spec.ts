jest.mock('@gitroom/nestjs-libraries/database/prisma/prisma.service', () => ({
  PrismaRepository: class {},
  PrismaService: class {},
}));
import { projectWordpressEditorial } from './wordpress.editorial';
import { PostsRepository } from './posts.repository';

const delivery = (id: string, date: string, extra = {}) => ({
  id,
  group: `group-${id}`,
  organizationId: 'org',
  createdAt: new Date(date),
  publishDate: new Date(date),
  state: 'PUBLISHED',
  releaseId: '42',
  settings: JSON.stringify({ type: 'posts', title: id }),
  content: id,
  tags: [],
  intervalInDays: null,
  integration: { id: 'channel', providerIdentifier: 'wordpress' },
  ...extra,
});
const original = delivery('original', '2026-01-01T10:00:00Z');
const latest = delivery('latest', '2026-10-21T10:00:00Z');

function repository(rows = [original, latest]) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const count = jest.fn().mockResolvedValue(rows.length);
  const repo = new PostsRepository(
    { model: { post: { findMany, count } } } as any,
    undefined as any,
    undefined as any,
    undefined as any,
    undefined as any,
    undefined as any,
    undefined as any
  );
  return { repo, findMany, count };
}

describe('WordPress editorial projection', () => {
  it('anchors the article at first publication but edits latest created source with its current tags/content', () => {
    const rows = [original, { ...latest, tags: [{ tag: { id: 'current' } }] }];
    const [article] = projectWordpressEditorial(rows);
    expect(article).toMatchObject({
      id: 'latest',
      group: 'group-latest',
      content: 'latest',
      publishDate: original.publishDate,
      wordpressTitle: 'latest',
      wordpressType: 'posts',
      tags: [{ tag: { id: 'current' } }],
    });
    expect(article.wordpressHistory?.map((p) => p.id)).toEqual([
      'latest',
      'original',
    ]);
    expect(article.wordpressHistory?.[0].createdAt).toEqual(latest.createdAt);
    expect(rows[1].publishDate).toEqual(latest.publishDate);
  });
  it('never mixes organizations, channels or REST types and defaults omitted type to posts', () => {
    const rows = [
      original,
      delivery('default-type', '2026-02-01', { settings: '{}' }),
      delivery('other-org', '2026-02-01', { organizationId: 'other' }),
      delivery('other-channel', '2026-02-01', {
        integration: { ...original.integration, id: 'other' },
      }),
      delivery('other-type', '2026-02-01', { settings: '{"type":"pages"}' }),
    ];
    expect(projectWordpressEditorial(rows)).toHaveLength(4);
  });
  it('keeps failed, queued, draft, invalid targets/settings and non-WordPress deliveries separate', () => {
    const rows = [
      original,
      latest,
      ...['ERROR', 'QUEUE', 'DRAFT'].map((state) =>
        delivery(state, '2026-10-22', { state })
      ),
      delivery('missing', '2026-10-22', { releaseId: 'missing' }),
      delivery('broken', '2026-10-22', { settings: 'not json' }),
      delivery('social', '2026-10-22', {
        integration: { ...original.integration, providerIdentifier: 'x' },
      }),
    ];
    expect(projectWordpressEditorial(rows)).toHaveLength(7);
  });
  it('keeps recurring WordPress deliveries separate from articles', () => {
    const recurring = { ...latest, id: 'repeat', intervalInDays: 7 };
    const rows = projectWordpressEditorial([original, latest, recurring]);
    expect(rows).toHaveLength(2);
    expect(
      rows.find((p) => p.id === 'repeat')?.wordpressHistory
    ).toBeUndefined();
    expect(rows.find((p) => p.id === 'latest')?.wordpressHistory).toHaveLength(
      2
    );
  });
  it('uses createdAt, not mutable updatedAt or publishDate, with a deterministic tie', () => {
    const changed = {
      ...original,
      publishDate: latest.publishDate,
      updatedAt: latest.createdAt,
    };
    expect(projectWordpressEditorial([changed, latest])[0].id).toBe('latest');
    expect(
      projectWordpressEditorial([latest, { ...latest, id: 'z' }])[0].id
    ).toBe('z');
  });
});

describe('editorial repository boundaries', () => {
  const january = {
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    customer: 'customer',
  };
  it('uses all-time successes so January shows the October editable source, not a stale January row', async () => {
    const { repo, findMany } = repository();
    const rows = await repo.getCalendarPosts('org', january);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'latest',
      publishDate: original.publishDate,
    });
    expect(rows[0].organizationId).toBeUndefined();
    expect(findMany.mock.calls[0][0].where).toMatchObject({
      integration: {
        organizationId: 'org',
        deletedAt: null,
        customerId: 'customer',
      },
      deletedAt: null,
      parentPostId: null,
    });
    expect(findMany.mock.calls[0][0].where.AND[1].OR).toContainEqual({
      state: 'PUBLISHED',
      integration: { providerIdentifier: 'wordpress' },
    });
  });
  it('does not move the article to the update month, but leaves failures visible there', async () => {
    const { repo } = repository([
      original,
      latest,
      delivery('error', '2026-10-22', { state: 'ERROR' }),
    ]);
    const rows = await repo.getCalendarPosts('org', {
      ...january,
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    });
    expect(rows.map((p) => p.id)).toEqual(['error']);
  });
  it('preserves raw public listing rows and range query', async () => {
    const { repo, findMany } = repository();
    const rows = await repo.getPosts('org', january);
    expect(rows.map((p) => p.id)).toEqual(['original', 'latest']);
    expect(rows[0].wordpressHistory).toBeUndefined();
    expect(findMany.mock.calls[0][0].where.AND[1].OR).toHaveLength(2);
    expect(findMany.mock.calls[0][0].select.createdAt).toBeUndefined();
  });
  it('projects before published pagination and uses article total, without leaking settings', async () => {
    const other = delivery('other', '2026-02-01', { releaseId: '99' });
    const { repo, findMany } = repository([original, latest, other]);
    const page = await repo.getPostsList('org', {
      state: 'published',
      page: 1,
      limit: 1,
    } as any);
    expect(page).toMatchObject({ total: 2, hasMore: false, page: 1 });
    expect(page.posts.map((p) => p.id)).toEqual(['latest']);
    expect(page.posts[0].settings).toBeUndefined();
    expect(findMany.mock.calls[0][0].skip).toBeUndefined();
    expect(findMany.mock.calls[0][0].take).toBeUndefined();
  });
});
