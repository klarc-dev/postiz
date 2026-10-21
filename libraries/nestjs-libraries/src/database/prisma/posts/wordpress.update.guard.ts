import { BadRequestException } from '@nestjs/common';

interface Delivery {
  id: string;
  state: string;
  releaseId: string | null;
  settings: string;
  createdAt: Date;
}

export function assertWordpressUpdateCurrent(
  sourceId: string,
  deliveries: Delivery[],
  settings: Record<string, any>
) {
  const reject = (message: string): never => {
    throw new BadRequestException(message);
  };
  const parseSettings = (raw: string): Record<string, any> => {
    try {
      const value = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error();
      return value;
    } catch {
      return reject(
        'Cannot verify WordPress delivery history: invalid stored settings.'
      );
    }
  };
  const source = deliveries.find((item) => item.id === sourceId);
  const sourceSettings = source ? parseSettings(source.settings) : {};
  if (
    !source ||
    source.state !== 'PUBLISHED' ||
    sourceSettings.__type !== 'wordpress' ||
    sourceSettings.type !== settings.type ||
    !Number.isSafeInteger(settings.existing_post_id) ||
    settings.existing_post_id <= 0 ||
    String(settings.existing_post_id) !== source.releaseId
  ) {
    reject(
      'MAJ requires the original published WordPress delivery and target.'
    );
  }
  if (
    ['slug', 'parent', 'status', 'author'].some(
      (key) => settings[key] !== undefined
    )
  ) {
    reject('MAJ cannot change the URL, parent, status or author.');
  }
  for (const item of deliveries) {
    if (item.id === source.id) continue;
    const other = parseSettings(item.settings);
    if (other.__type !== 'wordpress' || other.type !== settings.type) continue;
    if (
      item.state === 'QUEUE' &&
      Number(other.existing_post_id) === settings.existing_post_id
    ) {
      reject(
        'A WordPress update for this target is already pending. Check its delivery before retrying.'
      );
    }
    if (
      item.state === 'PUBLISHED' &&
      item.releaseId === source.releaseId &&
      item.createdAt >= source.createdAt
    ) {
      reject(
        'A newer WordPress delivery exists. Reopen the latest completed delivery before editing.'
      );
    }
  }
}
