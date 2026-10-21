import {
  prepareWordpressUpdate,
  wordpressUpdateTarget,
} from './wordpress.update';

const channel = {
  integration: 'wordpress-channel',
  settings: { type: 'articles' },
  posts: [{ state: 'PUBLISHED', releaseId: '2164' }],
};
const values = () => [
  {
    id: channel.integration,
    settings: {
      type: 'articles',
      title: 'Revised article',
      author: 24,
      status: 'publish',
      slug: 'old-slug',
      parent: 7304,
    },
    values: [
      { id: 'local-published-id', content: '<h2>Revised</h2>', media: [] },
    ],
  },
  {
    id: 'other-channel',
    settings: { type: 'articles' },
    values: [{ content: 'Do not send' }],
  },
];

describe('WordPress MAJ', () => {
  it('binds one fresh local delivery to the published remote ID without changing URL, visibility or author', () => {
    const input = values();
    const result = prepareWordpressUpdate(input, channel, 'wordpress');
    expect(result.id).toBe(channel.integration);
    expect(result.settings).toMatchObject({
      existing_post_id: 2164,
      title: 'Revised article',
    });
    const sent = JSON.parse(JSON.stringify(result));
    for (const key of ['slug', 'parent', 'status', 'author'])
      expect(sent.settings).not.toHaveProperty(key);
    expect(sent.values).toEqual([{ content: '<h2>Revised</h2>', media: [] }]);
    expect(input[0].values[0].id).toBe('local-published-id');
    expect(input[0].settings.author).toBe(24);
    expect(input[1].values[0].content).toBe('Do not send');
  });

  it.each(['missing', '', '0', '-1', '1.5', '1e3', '9007199254740992'])(
    'rejects invalid recorded ID %s without a create fallback',
    (releaseId) => {
      const target = { ...channel, posts: [{ state: 'PUBLISHED', releaseId }] };
      expect(wordpressUpdateTarget(target, 'wordpress')).toBeUndefined();
      expect(() =>
        prepareWordpressUpdate(values(), target, 'wordpress')
      ).toThrow();
    }
  );

  it.each(['DRAFT', 'QUEUE', 'ERROR'])(
    'does not offer remote MAJ for %s posts',
    (state) => {
      expect(
        wordpressUpdateTarget(
          { ...channel, posts: [{ state, releaseId: '2164' }] },
          'wordpress'
        )
      ).toBeUndefined();
    }
  );

  it('rejects another provider, unselected channel, changed REST type, comments and a conflicting explicit target', () => {
    expect(() =>
      prepareWordpressUpdate(values(), channel, 'linkedin')
    ).toThrow();
    expect(() => prepareWordpressUpdate([], channel, 'wordpress')).toThrow();
    const changedType = values();
    changedType[0].settings.type = 'pages';
    expect(() =>
      prepareWordpressUpdate(changedType, channel, 'wordpress')
    ).toThrow('original REST type');
    const comments = values();
    comments[0].values.push({ content: 'comment' });
    expect(() =>
      prepareWordpressUpdate(comments, channel, 'wordpress')
    ).toThrow('exactly one');
    const conflicting = values();
    Object.assign(conflicting[0].settings, { existing_post_id: 42 });
    expect(() =>
      prepareWordpressUpdate(conflicting, channel, 'wordpress')
    ).toThrow('differs');
  });
});
