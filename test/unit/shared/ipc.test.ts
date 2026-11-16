import { describe, it, expect } from 'vitest';
import { IPC, IPC_EVENTS } from '../../../src/shared/ipc';

describe('IPC contract', () => {
  it('uses a distinct channel for every command and event', () => {
    const channels = [...Object.values(IPC), ...Object.values(IPC_EVENTS)];
    expect(new Set(channels).size).toBe(channels.length);
  });
});
