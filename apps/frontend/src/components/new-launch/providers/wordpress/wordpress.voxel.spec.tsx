/** @jest-environment node */
import {
  jest,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
} from '@jest/globals';
import React, { useState } from 'react';
// These controls do not use canvas. Avoid requiring its optional native binding.
jest.mock('canvas', () => ({}));
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost',
});
Object.defineProperties(globalThis, {
  window: { value: dom.window, configurable: true },
  document: { value: dom.window.document, configurable: true },
  navigator: { value: dom.window.navigator, configurable: true },
});
const {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} = require('@testing-library/react');
import { FormProvider, useForm } from 'react-hook-form';
import { ExistingDataContextProvider } from '@gitroom/frontend/components/launches/helpers/use.existing.data';
import { SWRConfig } from 'swr';
import {
  WordpressVoxelFields,
  voxelDisplayValue,
  voxelCustomFields,
} from './wordpress.voxel';

jest.mock('@gitroom/frontend/components/launches/helpers/use.values', () => ({
  useSettings: () => require('react-hook-form').useFormContext(),
}));
jest.mock(
  '@gitroom/frontend/components/launches/helpers/use.integration',
  () => ({ useIntegration: () => ({ integration: { id: 'destination-a' } }) })
);
const request = jest.fn<any>();
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => request,
}));

let latestForm: ReturnType<typeof useForm>;
const schema = (type = 'posts') => ({
  supported: true,
  type,
  postType: type === 'posts' ? 'post' : 'page',
  fields: [
    { key: 'h1', type: 'text', label: 'Article heading', required: true },
    {
      key: 'faq',
      type: 'repeater',
      label: 'FAQ',
      children: [
        { key: 'question', label: 'Question', type: 'text' },
        { key: 'answer', label: 'Answer', type: 'texteditor' },
      ],
    },
    { key: 'enabled', type: 'switcher', label: 'Enabled' },
  ],
  values: {
    h1: 'Remote heading',
    faq: [
      {
        question: 'Existing question',
        answer: '<p>Existing answer</p>',
        opaque: 7,
      },
    ],
    enabled: true,
  },
  valuesStatus: 'loaded',
});
function Harness({
  initial = { type: 'posts', existing_post_id: 42 },
}: {
  initial?: any;
}) {
  const form = useForm({ defaultValues: initial });
  const [cache] = useState(() => new Map());
  latestForm = form;
  return (
    <SWRConfig
      value={{
        provider: () => cache,
        dedupingInterval: 0,
        loadingTimeout: 0,
      }}
    >
      <FormProvider {...form}>
        <button type="button" onClick={() => form.setValue('type', 'pages')}>
          Pages
        </button>
        <button type="button" onClick={() => form.setValue('type', 'posts')}>
          Posts
        </button>
        <WordpressVoxelFields name="voxel_fields" />
      </FormProvider>
    </SWRConfig>
  );
}
afterEach(async () => {
  await act(async () => {
    await Promise.resolve();
  });
  cleanup();
});
afterAll(() => dom.window.close());
beforeEach(() => {
  request.mockReset();
  request.mockImplementation(async (_url: any, options: any) => ({
    ok: true,
    json: async () => schema(JSON.parse(options.body).data.type),
  }));
});

it('loads recorded published target even when historical settings have no existing_post_id', async () => {
  render(
    <ExistingDataContextProvider
      value={{
        integration: 'destination-a',
        settings: { type: 'posts' },
        posts: [{ state: 'PUBLISHED', releaseId: '97571' }],
      }}
    >
      <Harness initial={{ type: 'posts' }} />
    </ExistingDataContextProvider>
  );
  await screen.findByDisplayValue('Existing question');
  expect(
    request.mock.calls.some(
      ([, options]: any[]) => JSON.parse(options.body).data.postId === 97571
    )
  ).toBe(true);
  expect(latestForm.getValues('existing_post_id')).toBeUndefined();
  fireEvent.click(screen.getByText('Add FAQ'));
  expect(latestForm.getValues('voxel_fields').faq).toHaveLength(2);
  expect(latestForm.getValues('voxel_fields').faq[0].question).toBe(
    'Existing question'
  );
});

it('renders actual destination labels, loads existing values without adding them to the outgoing patch', async () => {
  render(<Harness />);
  await screen.findByDisplayValue('Remote heading');
  expect(screen.getByDisplayValue('Existing question')).toBeTruthy();
  expect(screen.getByDisplayValue('<p>Existing answer</p>')).toBeTruthy();
  expect(latestForm.getValues('voxel_fields')).toBeUndefined();
  fireEvent.change(screen.getByLabelText('Article heading *'), {
    target: { value: 'Changed heading' },
  });
  expect(latestForm.getValues('voxel_fields')).toEqual({
    h1: 'Changed heading',
  });
});
it('edits repeater rows without dropping other child values and adds/removes rows', async () => {
  render(<Harness />);
  const question = await screen.findByDisplayValue('Existing question');
  fireEvent.change(question, { target: { value: 'Changed question' } });
  expect(latestForm.getValues('voxel_fields').faq[0]).toEqual({
    question: 'Changed question',
    answer: '<p>Existing answer</p>',
    opaque: 7,
  });
  fireEvent.click(screen.getByText('Add FAQ'));
  expect(latestForm.getValues('voxel_fields').faq).toHaveLength(2);
  fireEvent.click(screen.getByText('Remove FAQ 2'));
  expect(latestForm.getValues('voxel_fields').faq).toHaveLength(1);
});
it('preserves unknown saved fields and false values when editing one field', async () => {
  render(
    <Harness
      initial={{
        type: 'posts',
        voxel_fields: { unknown: { keep: 1 }, enabled: false },
      }}
    />
  );
  await screen.findByDisplayValue('Remote heading');
  expect((screen.getByLabelText('Enabled') as HTMLInputElement).checked).toBe(
    false
  );
  fireEvent.change(screen.getByLabelText('Article heading *'), {
    target: { value: 'Edited' },
  });
  expect(latestForm.getValues('voxel_fields')).toEqual({
    unknown: { keep: 1 },
    enabled: false,
    h1: 'Edited',
  });
});
it('scopes requests and unsaved patches to post type, restores original patch when returning', async () => {
  render(<Harness />);
  fireEvent.change(await screen.findByDisplayValue('Remote heading'), {
    target: { value: 'Post heading' },
  });
  fireEvent.click(screen.getByText('Pages'));
  await waitFor(() =>
    expect(
      request.mock.calls.some(
        ([, options]: any[]) => JSON.parse(options.body).data.type === 'pages'
      )
    ).toBe(true)
  );
  await screen.findByDisplayValue('Remote heading');
  expect(latestForm.getValues('voxel_fields')).toBeUndefined();
  fireEvent.change(screen.getByLabelText('Article heading *'), {
    target: { value: 'Page heading' },
  });
  fireEvent.click(screen.getByText('Posts'));
  await screen.findByDisplayValue('Post heading');
  expect(latestForm.getValues('voxel_fields')).toEqual({ h1: 'Post heading' });
});
it('shows explicit unsupported and error states without destroying saved values', async () => {
  request.mockResolvedValue({
    ok: true,
    json: async () => ({
      supported: false,
      type: 'posts',
      fields: [] as unknown[],
    }),
  });
  render(
    <Harness initial={{ type: 'posts', voxel_fields: { keep: 'saved' } }} />
  );
  await screen.findByText(/does not expose Voxel/);
  expect(latestForm.getValues('voxel_fields')).toEqual({ keep: 'saved' });
  cleanup();
  request.mockResolvedValue({ ok: false });
  render(<Harness />);
  await screen.findByRole('alert');
  expect(screen.getByText('Retry field discovery')).toBeTruthy();
});
it('normalizes read-only projections without changing their source objects and excludes native columns', () => {
  const read = { value: 'a', label: 'A' };
  expect(
    voxelDisplayValue(
      { key: 's', type: 'select', label: 'S', required: false },
      read
    )
  ).toBe('a');
  expect(read).toEqual({ value: 'a', label: 'A' });
  expect(
    voxelCustomFields([
      { key: 'title', type: 'title', label: 'Title', required: false },
      { key: '_thumbnail_id', type: 'image', label: 'Cover', required: false },
      { key: 'h1', type: 'text', label: 'H1', required: false },
    ]).map((f) => f.key)
  ).toEqual(['h1']);
});

it('resets one changed field to destination values without sending a replacement or losing other patches', async () => {
  render(
    <Harness
      initial={{
        type: 'posts',
        existing_post_id: 42,
        voxel_fields: { unknown: 7 },
      }}
    />
  );
  fireEvent.change(await screen.findByDisplayValue('Remote heading'), {
    target: { value: 'Edited' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Reset Article heading' })
  );
  expect(screen.getByDisplayValue('Remote heading')).toBeTruthy();
  expect(latestForm.getValues('voxel_fields')).toEqual({ unknown: 7 });
  fireEvent.click(screen.getByLabelText('Enabled'));
  fireEvent.click(screen.getByRole('button', { name: 'Reset Enabled' }));
  expect(latestForm.getValues('voxel_fields')).toEqual({ unknown: 7 });
});

it('reorders complete repeater rows without dropping unknown values, then resets to remote order', async () => {
  render(<Harness />);
  await screen.findByDisplayValue('Existing question');
  fireEvent.click(screen.getByText('Add FAQ'));
  fireEvent.change(screen.getAllByLabelText('Question')[1], {
    target: { value: 'Second question' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Move FAQ 2 up' }));
  expect(latestForm.getValues('voxel_fields').faq).toEqual([
    { question: 'Second question' },
    {
      question: 'Existing question',
      answer: '<p>Existing answer</p>',
      opaque: 7,
    },
  ]);
  fireEvent.click(screen.getByRole('button', { name: 'Reset FAQ' }));
  expect(latestForm.getValues('voxel_fields')).toBeUndefined();
  expect(screen.getAllByLabelText('Question')).toHaveLength(1);
});

it('canonicalizes known nested read projections while retaining unknown repeater children without mutating reads', () => {
  const field: any = {
    key: 'rows',
    type: 'repeater',
    children: [
      { key: 'select', type: 'select' },
      { key: 'multi', type: 'multiselect' },
      {
        key: 'nested',
        type: 'repeater',
        children: [{ key: 'image', type: 'image' }],
      },
    ],
  };
  const read = [
    {
      select: { value: 'a', label: 'A' },
      multi: [{ value: 'b', label: 'B' }],
      nested: [{ image: [{ id: 12, url: 'https://example.com/image.jpg' }] }],
      unknown: { keep: true },
    },
  ];
  const original = JSON.stringify(read);
  expect(voxelDisplayValue(field, read)).toEqual([
    {
      select: 'a',
      multi: ['b'],
      nested: [{ image: [12] }],
      unknown: { keep: true },
    },
  ]);
  expect(JSON.stringify(read)).toBe(original);
});

it('never copies enriched repeater siblings into a patch when editing a different child', async () => {
  const response: any = schema();
  response.fields[1].children.push({
    key: 'choice',
    label: 'Choice',
    type: 'select',
    choices: [{ value: 'a', label: 'A' }],
  });
  response.values.faq[0].choice = { value: 'a', label: 'A' };
  request.mockResolvedValue({ ok: true, json: async () => response });
  render(<Harness />);
  fireEvent.change(await screen.findByDisplayValue('Existing question'), {
    target: { value: 'Changed' },
  });
  expect(latestForm.getValues('voxel_fields').faq[0]).toEqual({
    question: 'Changed',
    answer: '<p>Existing answer</p>',
    opaque: 7,
    choice: 'a',
  });
  expect(response.values.faq[0].choice).toEqual({ value: 'a', label: 'A' });
});

it('ignores late discovery from another destination scope while retaining the active patch', async () => {
  let resolvePosts: (value: any) => void;
  request.mockImplementation(async (_url: any, options: any) => {
    const type = JSON.parse(options.body).data.type;
    if (type === 'posts')
      return new Promise((resolve) => {
        resolvePosts = resolve;
      });
    return {
      ok: true,
      json: async () => ({ ...schema(type), values: { h1: 'Page heading' } }),
    };
  });
  render(<Harness />);
  expect(screen.getByRole('status')).toBeTruthy();
  fireEvent.click(screen.getByText('Pages'));
  fireEvent.change(await screen.findByDisplayValue('Page heading'), {
    target: { value: 'Page edit' },
  });
  await act(async () => {
    resolvePosts!({ ok: true, json: async () => schema() });
  });
  expect(screen.queryByDisplayValue('Remote heading')).toBeNull();
  expect(screen.getByDisplayValue('Page edit')).toBeTruthy();
  expect(latestForm.getValues('voxel_fields')).toEqual({ h1: 'Page edit' });
});

it('refuses to edit existing repeaters when the response has not loaded the target values', async () => {
  request.mockResolvedValue({
    ok: true,
    json: async () => ({
      ...schema(),
      valuesStatus: 'not_requested',
      values: undefined as undefined,
    }),
  });
  render(<Harness />);
  await screen.findByRole('alert');
  expect(screen.queryByText('Add FAQ')).toBeNull();
  expect(latestForm.getValues('voxel_fields')).toBeUndefined();
});

it('shows destination-provided preserved labels as text without copying read objects into patches', async () => {
  const response: any = schema();
  response.fields.push({
    key: 'related',
    label: 'Related articles',
    type: 'post-relation',
  });
  response.values.related = [
    { id: 9, title: '<script>unsafe</script>' },
    { id: 10, title: 'Related title' },
  ];
  response.fields[0].description = 'Destination guidance';
  request.mockResolvedValue({ ok: true, json: async () => response });
  render(<Harness />);
  const heading = await screen.findByDisplayValue('Remote heading');
  const description = document.getElementById(
    heading.getAttribute('aria-describedby')
  );
  expect(description?.textContent).toBe('Destination guidance');
  expect(
    screen.getByText('<script>unsafe</script> (#9), Related title (#10)')
  ).toBeTruthy();
  expect(document.querySelector('script')).toBeNull();
  fireEvent.change(heading, { target: { value: 'Edited' } });
  expect(latestForm.getValues('voxel_fields')).toEqual({ h1: 'Edited' });
});

it('isolates deferred requests and unsaved patches by target post id, including cached returns', async () => {
  let resolveFirst: (value: any) => void;
  request.mockImplementation(async (_url: any, options: any) => {
    const id = JSON.parse(options.body).data.postId;
    const response = {
      ok: true,
      json: async () => ({ ...schema(), values: { h1: `Heading ${id}` } }),
    };
    if (id === 42)
      return new Promise((resolve) => {
        resolveFirst = resolve;
      });
    return response;
  });
  render(<Harness />);
  act(() => latestForm.setValue('existing_post_id', 43));
  fireEvent.change(await screen.findByDisplayValue('Heading 43'), {
    target: { value: 'Local 43' },
  });
  await act(async () => {
    resolveFirst!({
      ok: true,
      json: async () => ({ ...schema(), values: { h1: 'Heading 42' } }),
    });
  });
  expect(screen.getByDisplayValue('Local 43')).toBeTruthy();
  act(() => latestForm.setValue('existing_post_id', 42));
  fireEvent.change(await screen.findByDisplayValue('Heading 42'), {
    target: { value: 'Local 42' },
  });
  act(() => latestForm.setValue('existing_post_id', 43));
  await screen.findByDisplayValue('Local 43');
  expect(latestForm.getValues('voxel_fields')).toEqual({ h1: 'Local 43' });
});

it('ignores a late failure from an abandoned target without losing current values', async () => {
  let rejectFirst: (error: Error) => void;
  request.mockImplementation(async (_url: any, options: any) => {
    if (JSON.parse(options.body).data.postId === 42)
      return new Promise((_, reject) => {
        rejectFirst = reject;
      });
    return { ok: true, json: async () => schema() };
  });
  render(<Harness />);
  act(() => latestForm.setValue('existing_post_id', 43));
  await screen.findByDisplayValue('Existing question');
  await act(async () => {
    rejectFirst!(new Error('Old target failed'));
  });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByDisplayValue('Existing question')).toBeTruthy();
  expect(latestForm.getValues('voxel_fields')).toBeUndefined();
});
