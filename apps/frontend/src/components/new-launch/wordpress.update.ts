interface WordpressUpdateChannel {
  integration: string;
  settings: { type?: string };
  posts: { state: string; releaseId?: string | null }[];
}

/** Bind a remote update to the recorded WordPress ID, never a collection create.
 * A fresh local delivery preserves the published history and avoids restarting
 * its completed workflow. Only the channel in view is sent.
 */
export function wordpressUpdateTarget(
  channel: WordpressUpdateChannel,
  identifier?: string
): number | undefined {
  const root = channel.posts[0];
  if (identifier !== 'wordpress' || root?.state !== 'PUBLISHED') return;
  const id = Number(root.releaseId);
  return /^\d+$/.test(root.releaseId || '') &&
    Number.isSafeInteger(id) &&
    id > 0
    ? id
    : undefined;
}

export function prepareWordpressUpdate<
  T extends {
    id: string;
    settings: Record<string, any>;
    values: { id?: string; [key: string]: any }[];
  }
>(values: T[], channel: WordpressUpdateChannel, identifier?: string): T {
  const id = wordpressUpdateTarget(channel, identifier);
  const value = values.find((item) => item.id === channel.integration);
  if (
    !id ||
    !value ||
    !channel.settings.type ||
    value.settings.type !== channel.settings.type
  ) {
    throw new Error(
      'Cannot update WordPress: select the published channel with its original REST type and a valid recorded WordPress ID.'
    );
  }
  if (value.values.length !== 1) {
    throw new Error(
      'WordPress MAJ requires exactly one article, without comments.'
    );
  }
  if (
    value.settings.existing_post_id !== undefined &&
    value.settings.existing_post_id !== id
  ) {
    throw new Error(
      'The update target differs from the published WordPress ID.'
    );
  }
  return {
    ...value,
    settings: {
      ...value.settings,
      existing_post_id: id,
      // MAJ edits the article, not its canonical route, visibility or author.
      slug: undefined,
      parent: undefined,
      status: undefined,
      author: undefined,
    },
    values: value.values.map(({ id: _localId, ...item }) => item),
  } as T;
}
