import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { YoutubeSettingsDto } from './youtube.settings.dto';

const base = { title: 'Episode 1', type: 'public', tags: [] };

const errorsFor = async (value: object) =>
  validate(plainToInstance(YoutubeSettingsDto, { ...base, ...value }));

describe('YoutubeSettingsDto playlist and captions', () => {
  it('keeps playlist and captions optional', async () => {
    expect(await errorsFor({})).toEqual([]);
  });

  it('accepts a playlist id and a caption track', async () => {
    const errors = await errorsFor({
      playlistId: 'PL123',
      captions: [{ language: 'fr', name: '', srt: '1\n00:00:00,000 --> 00:00:01,000\nBonjour\n' }],
    });
    expect(errors).toEqual([]);
  });

  it('rejects a caption without content or language', async () => {
    const errors = await errorsFor({ captions: [{ language: '', srt: '' }] });
    expect(errors.map((error) => error.property)).toContain('captions');
  });
});
