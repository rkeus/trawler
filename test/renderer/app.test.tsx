// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../src/renderer/App';
import { fakeApi } from '../helpers/fake-api';
import { historyEntry } from '../helpers/history-entry';

async function open(setup?: (f: ReturnType<typeof fakeApi>) => void) {
  const fake = fakeApi();
  setup?.(fake);
  render(<App api={fake.api} />);
  await screen.findByRole('button', { name: 'Analyze' }).catch(() => undefined);
  return { fake, user: userEvent.setup() };
}

describe('Start screen', () => {
  it('shows the welcome steps while there is no history', async () => {
    await open();
    expect(await screen.findByText('Paste a link')).toBeTruthy();
    expect(screen.getByText('Cast a URL. Haul back the whole template.')).toBeTruthy();
  });

  it('asks to accept the legal note, once', async () => {
    const { fake, user } = await open((f) => f.api.getAppState.mockResolvedValue({ legalNoteAccepted: false, theme: 'dark', palette: 'ember' }));
    await user.click(await screen.findByRole('button', { name: 'Got it' }));
    expect(fake.api.updateAppState).toHaveBeenCalledWith({ legalNoteAccepted: true });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Got it' })).toBeNull());
  });

  it('shows an error for an empty URL and starts nothing', async () => {
    const { fake, user } = await open();
    await user.click(await screen.findByRole('button', { name: 'Analyze' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Enter the template URL.');
    expect(fake.api.startJob).not.toHaveBeenCalled();
  });

  it('starts an analysis with the form values', async () => {
    const { fake, user } = await open();
    await user.type(await screen.findByLabelText('Template URL'), 'example.com/template/');
    await user.click(screen.getByRole('radio', { name: 'JS' }));
    await user.click(screen.getByRole('button', { name: 'Analyze' }));
    expect(fake.api.startJob).toHaveBeenCalledWith({
      kind: 'analyze',
      seedUrl: 'https://example.com/template/',
      settings: { mode: 'js', downloadExternal: true },
    });
    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeTruthy(); // the progress screen
  });

  it('asks what to do when the output folder is not empty', async () => {
    const { fake, user } = await open((f) => {
      f.api.chooseFolder.mockResolvedValue('D:\\out');
      f.api.inspectFolder.mockResolvedValue('non-empty');
    });
    await user.type(await screen.findByLabelText('Template URL'), 'example.com');
    await user.click(screen.getByRole('button', { name: 'Choose output folder' }));
    await screen.findByText('D:\\out');
    await user.click(screen.getByRole('button', { name: 'Download' }));
    const dialog = await screen.findByRole('dialog');
    expect(fake.api.startJob).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Merge' }));
    expect(fake.api.startJob).toHaveBeenCalledWith({
      kind: 'download',
      seedUrl: 'https://example.com/',
      outputDir: 'D:\\out',
      folderPolicy: 'merge',
      settings: { mode: 'auto', downloadExternal: true },
    });
  });

  it('repeats an earlier job with its stored settings', async () => {
    const entry = historyEntry('h1');
    const { fake, user } = await open((f) => f.api.listHistory.mockResolvedValue([entry]));
    const row = (await screen.findByText('example.com')).closest('li')!;
    await user.click(within(row).getByRole('button', { name: 'Repeat' }));
    expect(fake.api.startJob).toHaveBeenCalledTimes(1);
    const sent = fake.api.startJob.mock.calls[0]![0];
    expect(sent).toMatchObject({ kind: 'analyze', seedUrl: 'https://example.com/' });
    expect(sent.settings).toMatchObject({ maxPages: entry.settings.maxPages });
  });

  it('removes a history entry', async () => {
    const { fake, user } = await open((f) => f.api.listHistory.mockResolvedValue([historyEntry('h1')]));
    const row = (await screen.findByText('example.com')).closest('li')!;
    await user.click(within(row).getByRole('button', { name: 'Remove' }));
    expect(fake.api.removeHistory).toHaveBeenCalledWith('h1');
  });
});
