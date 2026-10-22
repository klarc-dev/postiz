/** @jest-environment node */
import {
  jest,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
} from '@jest/globals';
import React from 'react';
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
  latestForm = form;
  return (
    <SWRConfig
      value={{
        provider: () => new Map(),
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
