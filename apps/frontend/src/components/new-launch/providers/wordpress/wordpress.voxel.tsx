'use client';

import { FC, useEffect, useId, useRef } from 'react';
import useSWR from 'swr';
import { useWatch } from 'react-hook-form';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { useExistingData } from '@gitroom/frontend/components/launches/helpers/use.existing.data';
import { wordpressUpdateTarget } from '@gitroom/frontend/components/new-launch/wordpress.update';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import type {
  WordpressVoxelField,
  WordpressVoxelSchema,
} from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/wordpress.dto';

const control =
  'w-full min-w-0 px-[12px] py-[8px] rounded-[4px] bg-input border border-fifth text-[14px] focus-visible:ring-2 focus-visible:ring-btnPrimary';
const action =
  'rounded-[4px] px-[8px] py-[6px] text-[13px] border border-newSep focus-visible:ring-2 focus-visible:ring-btnPrimary disabled:opacity-40';
const object = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const owns = (value: unknown, key: string) =>
  object(value) && Object.prototype.hasOwnProperty.call(value, key);

/** Read projections are display-only. Never send the serializer's enriched objects back. */
export function voxelDisplayValue(field: WordpressVoxelField, value: any): any {
  if (field.type === 'repeater' && Array.isArray(value))
    return value.map((row) =>
      object(row)
        ? Object.fromEntries(
            Object.entries(row).map(([key, item]) => {
              const child = field.children?.find((child) => child.key === key);
              return [key, child ? voxelDisplayValue(child, item) : item];
            })
          )
        : row
    );
  if (field.type === 'select' && object(value)) return value.value;
  if (field.type === 'multiselect' && Array.isArray(value))
    return value.map((item) => (object(item) ? item.value : item));
  if (
    ['image', 'file', 'profile-avatar', 'post-relation', 'taxonomy'].includes(
      field.type
    )
  ) {
    const items = Array.isArray(value) ? value : value == null ? [] : [value];
    return items
      .map((item) => (object(item) ? item.id : item))
      .filter((item) => Number.isSafeInteger(Number(item)) && Number(item) > 0)
      .map(Number);
  }
  return value;
}

export function voxelCustomFields(fields: WordpressVoxelField[]) {
  return fields.filter(
    (field) =>
      ![
        'title',
        'description',
        'excerpt',
        'core-column',
        'ui-step',
        'ui-heading',
        'ui-html',
      ].includes(field.type) &&
      ![
        '_thumbnail_id',
        'post_title',
        'post_content',
        'post_author',
        'post_status',
      ].includes(field.key)
  );
}

function useVoxelSchema(
  integrationId: string | undefined,
  type: string,
  postId: number | undefined
) {
  const fetch = useFetch();
  return useSWR<WordpressVoxelSchema>(
    integrationId && type
      ? ['wordpress-voxel-schema', integrationId, type, postId || null]
      : null,
    async () => {
      const response = await fetch('/integrations/function', {
        method: 'POST',
        body: JSON.stringify({
          id: integrationId,
          name: 'voxelFieldSchema',
          data: { type, ...(postId ? { postId } : {}) },
        }),
      });
      if (!response.ok)
        throw new Error(
          'Could not load the destination field definitions. Check the connected user permissions.'
        );
      const result = await response.json();
      if (
        !result ||
        typeof result.supported !== 'boolean' ||
        !Array.isArray(result.fields) ||
        result.type !== type ||
        (result.supported &&
          postId &&
          (result.valuesStatus !== 'loaded' || !object(result.values)))
      )
        throw new Error(
          'The destination returned an invalid field definition.'
        );
      return result;
    },
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
      keepPreviousData: false,
    }
  );
}

const VoxelControl: FC<{
  field: WordpressVoxelField;
  value: any;
  readValue?: any;
  onChange: (value: any) => void;
  onReset?: () => void;
  depth?: number;
}> = ({ field, value, readValue, onChange, onReset, depth = 0 }) => {
  const id = useId();
  const kind = field.type;
  const text =
    typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  const choices = field.choices || [];
  const props = {
    id,
    'aria-describedby': field.description ? `${id}-description` : undefined,
    className: control,
  };
  const label = (
    <label id={`${id}-label`} htmlFor={id} className="text-[14px] font-medium">
      {field.label || field.key}
      {field.required ? ' *' : ''}
    </label>
  );
  let input;
  if (kind === 'repeater' && field.children?.length && depth < 5) {
    const rows = Array.isArray(value) ? value : [];
    input = (
      <div
        role="group"
        aria-labelledby={`${id}-label`}
        aria-describedby={props['aria-describedby']}
        className="flex flex-col gap-[12px]"
      >
        {rows.map((row: any, index: number) => (
          <fieldset
            key={index}
            className="border border-fifth rounded-[4px] p-[12px] min-w-0 flex flex-col gap-[12px]"
          >
            <legend>
              {field.label || field.key} {index + 1}
            </legend>
            {field.children!.map((child) => (
              <VoxelControl
                key={child.key}
                field={child}
                value={object(row) ? row[child.key] : undefined}
                depth={depth + 1}
                onChange={(next) =>
                  onChange(
                    rows.map((old: any, i: number) =>
                      i === index
                        ? { ...(object(old) ? old : {}), [child.key]: next }
                        : old
                    )
                  )
                }
              />
            ))}
            <div className="flex flex-wrap gap-[8px]">
              {[-1, 1].map((direction) => (
                <button
                  key={direction}
                  type="button"
                  className={action}
                  disabled={
                    index + direction < 0 || index + direction >= rows.length
                  }
                  aria-label={`Move ${field.label || field.key} ${index + 1} ${
                    direction < 0 ? 'up' : 'down'
                  }`}
                  onClick={() => {
                    const next = [...rows];
                    [next[index], next[index + direction]] = [
                      next[index + direction],
                      next[index],
                    ];
                    onChange(next);
                  }}
                >
                  {direction < 0 ? 'Move up' : 'Move down'}
                </button>
              ))}
              <button
                type="button"
                className={action}
                onClick={() =>
                  onChange(rows.filter((_: any, i: number) => i !== index))
                }
              >
                Remove {field.label || field.key} {index + 1}
              </button>
            </div>
          </fieldset>
        ))}
        <button
          type="button"
          className={`self-start ${action}`}
          onClick={() => onChange([...rows, {}])}
        >
          Add {field.label || field.key}
        </button>
      </div>
    );
  } else if (kind === 'switcher') {
    input = (
      <input
        {...props}
        type="checkbox"
        checked={value === true}
        onChange={(event) => onChange(event.target.checked)}
        className="self-start h-[20px] w-[20px] focus-visible:ring-2 focus-visible:ring-btnPrimary"
      />
    );
  } else if (kind === 'select' && choices.length) {
    input = (
      <select
        {...props}
        value={text}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Select…</option>
        {text && !choices.some((choice) => String(choice.value) === text) ? (
          <option value={text}>{text} (current value)</option>
        ) : null}
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    );
  } else if (kind === 'multiselect' && choices.length) {
    const selected: string[] = Array.isArray(value) ? value.map(String) : [];
    input = (
      <fieldset
        id={id}
        aria-describedby={props['aria-describedby']}
        aria-labelledby={`${id}-label`}
        className="flex flex-col gap-[8px]"
      >
        {[
          ...choices,
          ...selected
            .filter(
              (item) => !choices.some((choice) => String(choice.value) === item)
            )
            .map((item) => ({ value: item, label: `${item} (current value)` })),
        ].map((choice) => (
          <label key={choice.value} className="flex items-center gap-[8px]">
            <input
              type="checkbox"
              checked={selected.includes(String(choice.value))}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, String(choice.value)]
                    : selected.filter((item) => item !== String(choice.value))
                )
              }
            />
            {choice.label}
          </label>
        ))}
      </fieldset>
    );
  } else if (
    ['image', 'file', 'profile-avatar', 'post-relation', 'taxonomy'].includes(
      kind
    )
  ) {
    const items = Array.isArray(readValue) ? readValue : [readValue];
    input = (
      <div className="text-[13px] opacity-80">
        <p>
          A destination-aware picker is not available for this field yet. Its
          value is preserved.
        </p>
        <p>
          {Array.isArray(value) && value.length
            ? value
                .map((id) => {
                  const item = items.find(
                    (item) => object(item) && Number(item.id) === id
                  );
                  const label = item?.name || item?.title;
                  return typeof label === 'string' && label
                    ? `${label} (#${id})`
                    : `#${id}`;
                })
                .join(', ')
            : 'No current value'}
        </p>
      </div>
    );
  } else if (
    [
      'text',
      'texteditor',
      'textarea',
      'url',
      'email',
      'phone',
      'number',
      'date',
      'time',
      'color',
    ].includes(kind)
  ) {
    const multiline = ['texteditor', 'textarea'].includes(kind);
    const textProps = {
      ...props,
      value: text,
      placeholder: field.placeholder || '',
      maxLength: field.maxlength || undefined,
    };
    input = multiline ? (
      <textarea
        {...textProps}
        rows={4}
        onChange={(event) => onChange(event.target.value)}
      />
    ) : (
      <input
        {...textProps}
        type={
          ['url', 'email', 'number', 'date', 'time', 'color'].includes(kind)
            ? kind
            : kind === 'phone'
            ? 'tel'
            : 'text'
        }
        min={field.min}
        max={field.max}
        step={field.step}
        onChange={(event) => {
          const next = event.target.value;
          if (kind !== 'number') onChange(next);
          else if (next === '') onChange(null);
          else if (Number.isFinite(Number(next))) onChange(Number(next));
        }}
      />
    );
  } else {
    input = (
      <div className="text-[13px] opacity-80">
        <p>
          {kind === 'repeater'
            ? 'The destination did not expose the child field definitions. This field is preserved, not guessed.'
            : `This destination field type (${kind}) is not editable here yet. Its value is preserved.`}
        </p>
        {value !== undefined ? (
          <pre className="whitespace-pre-wrap break-words max-h-[160px] overflow-auto mt-[6px]">
            {JSON.stringify(value, null, 2)}
          </pre>
        ) : null}
      </div>
    );
  }
  return (
    <div
      className="flex flex-col gap-[6px] min-w-0"
      data-voxel-field={field.key}
    >
      <div className="flex items-center justify-between gap-[8px]">
        {label}
        {onReset ? (
          <button
            type="button"
            className={action}
            aria-label={`Reset ${field.label || field.key}`}
            onClick={onReset}
          >
            Reset
          </button>
        ) : null}
      </div>
      {field.description ? (
        <p id={`${id}-description`} className="text-[12px] opacity-70">
          {field.description}
        </p>
      ) : null}
      {input}
    </div>
  );
};

export const WordpressVoxelFields: FC<{ name: string }> = ({ name }) => {
  const form = useSettings();
  const { integration } = useIntegration();
  const type = String(useWatch({ control: form.control, name: 'type' }) || '');
  const explicitPostId = useWatch({
    control: form.control,
    name: 'existing_post_id',
  });
  const existing = useExistingData();
  const channel = [existing, ...(existing.siblings || [])].find(
    (item) => item.integration === integration?.id
  );
  const recordedPostId =
    channel && channel.settings.type === type
      ? wordpressUpdateTarget(channel, 'wordpress')
      : undefined;
  const postId = recordedPostId || explicitPostId;
  const patch = useWatch({ control: form.control, name });
  const scope = `${integration?.id || ''}:${type}:${postId || ''}`;
  const previousScope = useRef(scope);
  const patches = useRef(new Map<string, any>());
  const { data, error, isLoading, mutate } = useVoxelSchema(
    integration?.id,
    type,
    postId
  );

  // Switching destinations must never silently send fields from another schema.
  // Keep each unsaved patch in its own scope so switching back restores it.
  useEffect(() => {
    if (previousScope.current !== scope) {
      patches.current.set(previousScope.current, form.getValues(name));
      previousScope.current = scope;
      form.setValue(name, patches.current.get(scope), { shouldValidate: true });
    }
  }, [scope, form, name]);

  if (!type)
    return (
      <p className="text-[13px] mt-[12px]">
        Select a destination post type to load its custom fields.
      </p>
    );
  if (isLoading)
    return (
      <p role="status" className="text-[13px] mt-[12px]">
        Loading destination fields…
      </p>
    );
  if (error)
    return (
      <div role="alert" className="text-[13px] mt-[12px]">
        <p>{error.message}</p>
        <button type="button" className="underline" onClick={() => mutate()}>
          Retry field discovery
        </button>
        <p>Existing custom field values are preserved.</p>
      </div>
    );
  if (!data?.supported)
    return (
      <p className="text-[13px] mt-[12px]">
        This destination does not expose Voxel field definitions. Existing
        custom field values are preserved.
      </p>
    );
  const fields = voxelCustomFields(data.fields);
  const currentPatch =
    previousScope.current === scope && object(patch) ? patch : {};
  const unknown = Object.keys(currentPatch).filter(
    (key) => !data.fields.some((field) => field.key === key)
  );
  const update = (key: string, value?: unknown) => {
    const next = {
      ...(object(form.getValues(name)) ? form.getValues(name) : {}),
    };
    if (value === undefined) delete next[key];
    else next[key] = value;
    form.setValue(name, Object.keys(next).length ? next : undefined, {
      shouldValidate: true,
      shouldDirty: true,
    });
  };
  return (
    <section
      className="mt-[16px] flex flex-col gap-[16px] min-w-0"
      aria-label="Destination Voxel fields"
    >
      <div>
        <h3 className="font-semibold">Destination fields</h3>
        <p className="text-[12px] opacity-70">
          {data.postType} · Definitions from the connected WordPress site. Only
          changed custom fields are sent. Required fields are marked * and
          validated by the destination.
        </p>
      </div>
      {fields.length ? (
        fields.map((field) => (
          <VoxelControl
            key={`${scope}:${field.key}`}
            field={field}
            readValue={data.values?.[field.key]}
            value={voxelDisplayValue(
              field,
              owns(currentPatch, field.key)
                ? currentPatch[field.key]
                : data.values?.[field.key]
            )}
            onReset={
              owns(currentPatch, field.key)
                ? () => update(field.key)
                : undefined
            }
            onChange={(next) => update(field.key, next)}
          />
        ))
      ) : (
        <p className="text-[13px]">
          No additional Voxel fields for this post type. Core fields are edited
          above.
        </p>
      )}
      {unknown.length ? (
        <p className="text-[12px] opacity-70">
          Preserving additional saved fields: {unknown.join(', ')}.
        </p>
      ) : null}
      {form.formState.errors?.[name]?.message ? (
        <p role="alert" className="text-red-400 text-[12px]">
          {String(form.formState.errors[name]?.message)}
        </p>
      ) : null}
    </section>
  );
};
