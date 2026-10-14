'use client';

import { FC, useEffect, useState } from 'react';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';

type Caption = { language: string; name?: string; srt: string };

// Caption tracks are stored inline in the post settings so the whole YouTube
// publication (video, thumbnail, playlist, subtitles) lives in Postiz.
export const YoutubeCaptions: FC<{
  name: string;
  onChange: (event: { target: { value: Caption[]; name: string } }) => void;
}> = ({ name, onChange }) => {
  const { getValues } = useSettings();
  const [captions, setCaptions] = useState<Caption[]>([]);

  useEffect(() => {
    setCaptions(getValues()[name] || []);
  }, []);

  const update = (next: Caption[]) => {
    setCaptions(next);
    onChange({ target: { value: next, name } });
  };

  const addFile = async (file?: File) => {
    if (!file) {
      return;
    }
    // "episode.fr.srt" -> "fr"; default to French otherwise.
    const match = file.name.match(/\.([a-z]{2,3}(?:-[A-Za-z]{2})?)\.(srt|vtt)$/);
    update([
      ...captions,
      { language: match?.[1] || 'fr', name: '', srt: await file.text() },
    ]);
  };

  return (
    <div className="flex flex-col gap-[8px] mt-[20px]">
      <div className="text-[14px]">Subtitles (optional)</div>
      {captions.map((caption, index) => (
        <div key={index} className="flex gap-[8px] items-center">
          <input
            className="h-[36px] w-[90px] px-[8px] rounded-[4px] bg-input border border-fifth"
            value={caption.language}
            aria-label="Language"
            onChange={(event) =>
              update(
                captions.map((c, i) =>
                  i === index ? { ...c, language: event.target.value } : c
                )
              )
            }
          />
          <input
            className="h-[36px] flex-1 px-[8px] rounded-[4px] bg-input border border-fifth"
            value={caption.name || ''}
            placeholder="Track name (optional)"
            onChange={(event) =>
              update(
                captions.map((c, i) =>
                  i === index ? { ...c, name: event.target.value } : c
                )
              )
            }
          />
          <span className="text-[12px] opacity-70">
            {caption.srt.split(/\r?\n\r?\n/).filter(Boolean).length} cues
          </span>
          <button
            type="button"
            className="text-[12px] underline"
            onClick={() => update(captions.filter((_, i) => i !== index))}
          >
            Remove
          </button>
        </div>
      ))}
      <input
        type="file"
        accept=".srt,.vtt"
        onChange={(event) => {
          addFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </div>
  );
};
