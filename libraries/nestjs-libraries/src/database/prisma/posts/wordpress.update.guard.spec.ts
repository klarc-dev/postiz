import { assertWordpressUpdateCurrent } from './wordpress.update.guard';

const settings = {
  __type: 'wordpress',
  type: 'articles',
  existing_post_id: 2164,
};
const source = {
  id: 'source',
  state: 'PUBLISHED',
  releaseId: '2164',
  createdAt: new Date('2026-10-21T10:00:00Z'),
  settings: JSON.stringify(settings),
};
const guard = (deliveries = [source], next = settings) =>
  assertWordpressUpdateCurrent('source', deliveries, next);

describe('WordPress MAJ latest-delivery gate', () => {
  it('accepts only the latest completed source and ignores its own matching row', () => {
    expect(() => guard()).not.toThrow();
    expect(() =>
      guard([
        source,
        { ...source, id: 'older', createdAt: new Date('2026-10-20') },
      ])
    ).not.toThrow();
  });
  it('rejects old history even if it was recently edited locally', () => {
    expect(() =>
      guard([
        source,
        { ...source, id: 'newer', createdAt: new Date('2026-10-22') },
      ])
    ).toThrow('newer WordPress delivery');
  });
  it('rejects equal generation timestamps conservatively', () => {
    expect(() => guard([source, { ...source, id: 'same-time' }])).toThrow(
      'newer WordPress delivery'
    );
  });
  it('rejects pending target even before it has a release ID', () => {
    expect(() =>
      guard([
        source,
        { ...source, id: 'pending', state: 'QUEUE', releaseId: null },
      ])
    ).toThrow('already pending');
  });
  it('ignores deliveries of a different REST type or remote target', () => {
    expect(() =>
      guard([
        source,
        {
          ...source,
          id: 'other-id',
          releaseId: '42',
          settings: JSON.stringify({ ...settings, existing_post_id: 42 }),
        },
        {
          ...source,
          id: 'other-type',
          settings: JSON.stringify({ ...settings, type: 'pages' }),
        },
      ])
    ).not.toThrow();
  });
  it('rejects sources absent from the org/integration scoped query or not published', () => {
    expect(() => guard([])).toThrow('original published');
    expect(() => guard([{ ...source, state: 'QUEUE' }])).toThrow(
      'original published'
    );
  });
  it.each(['slug', 'parent', 'status', 'author'])(
    'rejects modifying protected %s',
    (key) => {
      expect(() => guard([source], { ...settings, [key]: 'changed' })).toThrow(
        'cannot change'
      );
    }
  );
  it('rejects changed target or REST type', () => {
    expect(() =>
      guard([source], { ...settings, existing_post_id: 42 })
    ).toThrow('original published');
    expect(() => guard([source], { ...settings, type: 'pages' })).toThrow(
      'original published'
    );
  });
});
