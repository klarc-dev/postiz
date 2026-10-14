'use client';

import { FC, useEffect, useState } from 'react';
import { Select } from '@gitroom/react/form/select';
import { useCustomProviderFunction } from '@gitroom/frontend/components/launches/helpers/use.custom.provider.function';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';

// Klarc fork: optional native WordPress metadata. Empty inputs are unset (the
// provider then sends nothing), so they never clear what WordPress stores.

export const WordpressAuthor: FC<{ name: string }> = ({ name }) => {
  const customFunc = useCustomProviderFunction();
  const form = useSettings();
  const [authors, setAuthors] = useState<Array<{ id: number; name: string }>>([]);

  useEffect(() => {
    customFunc.get('authorsList').then((data) => setAuthors(data || []));
  }, []);

  if (!authors.length) {
    return null;
  }

  return (
    <Select
      name={name}
      label="Author (optional)"
      value={form.getValues()[name] ?? ''}
      onChange={(event) =>
        form.setValue(name, event.target.value ? Number(event.target.value) : undefined, {
          shouldValidate: true,
        })
      }
    >
      <option value="">Connected user</option>
      {authors.map((author) => (
        <option key={author.id} value={author.id}>
          {author.name}
        </option>
      ))}
    </Select>
  );
};

export const WordpressOptionalText: FC<{
  name: string;
  label: string;
  multiline?: boolean;
  placeholder?: string;
}> = ({ name, label, multiline, placeholder }) => {
  const form = useSettings();
  const [value, setValue] = useState<string>(form.getValues()[name] ?? '');
  const update = (next: string) => {
    setValue(next);
    form.setValue(name, next === '' ? undefined : next, { shouldValidate: true });
  };
  const className =
    'w-full px-[12px] rounded-[4px] bg-input border border-fifth text-[14px]';

  return (
    <div className="flex flex-col gap-[6px] mt-[12px]">
      <label className="text-[14px]">{label}</label>
      {multiline ? (
        <textarea
          className={`${className} py-[8px] min-h-[80px]`}
          value={value}
          placeholder={placeholder}
          onChange={(event) => update(event.target.value)}
        />
      ) : (
        <input
          className={`${className} h-[40px]`}
          value={value}
          placeholder={placeholder}
          onChange={(event) => update(event.target.value)}
        />
      )}
      {form.formState.errors?.[name]?.message ? (
        <div className="text-red-400 text-[12px]">
          {String(form.formState.errors[name]?.message)}
        </div>
      ) : null}
    </div>
  );
};

export const WordpressVoxelFields: FC<{ name: string }> = ({ name }) => {
  const form = useSettings();
  const initial = form.getValues()[name];
  const [text, setText] = useState<string>(initial ? JSON.stringify(initial, null, 2) : '');
  const [parseError, setParseError] = useState<string>('');

  const update = (next: string) => {
    setText(next);
    if (!next.trim()) {
      setParseError('');
      form.setValue(name, undefined, { shouldValidate: true });
      return;
    }
    try {
      form.setValue(name, JSON.parse(next), { shouldValidate: true });
      setParseError('');
    } catch {
      setParseError('Invalid JSON');
    }
  };

  return (
    <div className="flex flex-col gap-[6px] mt-[12px]">
      <label className="text-[14px]">Voxel fields (optional JSON)</label>
      <textarea
        className="w-full px-[12px] py-[8px] rounded-[4px] bg-input border border-fifth text-[13px] font-mono min-h-[120px]"
        value={text}
        placeholder='{"h1": "…", "faq": [{"question": "…", "answer": "<p>…</p>"}]}'
        onChange={(event) => update(event.target.value)}
      />
      {parseError || form.formState.errors?.[name]?.message ? (
        <div className="text-red-400 text-[12px]">
          {parseError || String(form.formState.errors[name]?.message)}
        </div>
      ) : null}
    </div>
  );
};
