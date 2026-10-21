import { expandPosts, expandPostsList, minifyPosts, minifyPostsList } from './posts.list.minify';

describe('editorial calendar transport', () => {
  const post = {
    id: 'latest', content: '<p>current</p>', publishDate: '2026-10-01T10:00:00Z',
    integration: { id: 'wp', providerIdentifier: 'wordpress', name: 'Site', picture: null },
    tags: [], releaseId: '2164', state: 'PUBLISHED', group: 'latest-group',
    wordpressTitle: 'An article', wordpressType: 'posts',
    wordpressHistory: [
      { id: 'latest', group: 'latest-group', createdAt: '2026-10-21T10:00:00Z', publishDate: '2026-10-21T10:00:00Z', state: 'PUBLISHED' },
      { id: 'first', group: 'first-group', createdAt: '2026-10-01T10:00:00Z', publishDate: '2026-10-01T10:00:00Z', state: 'PUBLISHED' },
    ],
  };
  it('roundtrips full calendar history and latest editable source', () => {
    expect(expandPosts(minifyPosts({ posts: [post] }))).toEqual({ posts: [post] });
  });
  it('roundtrips editorial pagination totals and history', () => {
    const list = { posts: [post], total: 13, page: 0, limit: 100, hasMore: false };
    expect(expandPostsList(minifyPostsList(list))).toEqual(list);
  });
});
