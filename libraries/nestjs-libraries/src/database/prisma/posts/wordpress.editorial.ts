interface Delivery {
  id: string;
  group: string;
  organizationId: string;
  createdAt: Date;
  publishDate: Date;
  state: string;
  releaseId: string | null;
  settings: string;
  intervalInDays?: number | null;
  integration: { id: string; providerIdentifier: string };
}

/** Presentation only. The newest successful delivery remains the editable source.
 * Call with all successful deliveries in scope before date filtering/pagination.
 */
export function projectWordpressEditorial<T extends Delivery>(deliveries: T[]) {
  const articles = new Map<string, T[]>();
  const result: (T & {
    wordpressTitle?: string;
    wordpressType?: string;
    wordpressHistory?: {
      id: string;
      group: string;
      publishDate: Date;
      createdAt: Date;
      state: string;
    }[];
  })[] = [];
  for (const delivery of deliveries) {
    let settings: Record<string, unknown> | undefined;
    try {
      const parsed = JSON.parse(delivery.settings);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        settings = parsed;
    } catch {}
    const releaseId = Number(delivery.releaseId);
    const type = settings?.type === undefined ? 'posts' : settings.type;
    if (
      delivery.integration.providerIdentifier !== 'wordpress' ||
      delivery.state !== 'PUBLISHED' ||
      delivery.intervalInDays != null ||
      !/^\d+$/.test(delivery.releaseId || '') ||
      !Number.isSafeInteger(releaseId) ||
      releaseId <= 0 ||
      !settings ||
      typeof type !== 'string' ||
      !/^[a-z0-9_-]+$/i.test(type)
    ) {
      result.push(delivery);
      continue;
    }
    const key = JSON.stringify([
      delivery.organizationId,
      delivery.integration.id,
      type,
      releaseId,
    ]);
    const history = articles.get(key) || [];
    history.push(delivery);
    articles.set(key, history);
  }
  for (const history of articles.values()) {
    history.sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() ||
        b.id.localeCompare(a.id)
    );
    const latest = history[0];
    const settings = JSON.parse(latest.settings);
    result.push({
      ...latest,
      publishDate: new Date(
        Math.min(...history.map((post) => post.publishDate.getTime()))
      ),
      wordpressTitle:
        typeof settings.title === 'string' ? settings.title : undefined,
      wordpressType: settings.type ?? 'posts',
      wordpressHistory: history.map(
        ({ id, group, publishDate, createdAt, state }) => ({
          id,
          group,
          publishDate,
          createdAt,
          state,
        })
      ),
    });
  }
  return result;
}
