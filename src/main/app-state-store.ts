import path from 'node:path';
import { PALETTES, THEMES, type AppState } from '../shared/ipc';
import { isRecord, readJsonFile, writeJsonFile, WriteQueue } from './json-file';

export const DEFAULT_APP_STATE: Readonly<AppState> = Object.freeze<AppState>({ legalNoteAccepted: false, theme: 'dark', palette: 'ember' });

/** Applies the valid fields of `input` on top of `base`; anything else is ignored. */
export function resolveAppState(base: AppState, input: unknown): AppState {
  const out: AppState = { ...base };
  if (!isRecord(input)) return out;
  if (typeof input.legalNoteAccepted === 'boolean') out.legalNoteAccepted = input.legalNoteAccepted;
  if (typeof input.lastOutputDir === 'string' && input.lastOutputDir.trim() !== '') out.lastOutputDir = input.lastOutputDir;
  if (typeof input.theme === 'string' && (THEMES as readonly string[]).includes(input.theme)) out.theme = input.theme as AppState['theme'];
  if (typeof input.palette === 'string' && (PALETTES as readonly string[]).includes(input.palette)) out.palette = input.palette as AppState['palette'];
  return out;
}

/** Small UI facts that are not job settings (userData/app-state.json). */
export class AppStateStore {
  private state: AppState = { ...DEFAULT_APP_STATE };
  private warnings: string[] = [];
  private readonly queue = new WriteQueue();

  constructor(private readonly file: string) {}

  static fileIn(dir: string): string {
    return path.join(dir, 'app-state.json');
  }

  async load(): Promise<AppState> {
    const { value, movedTo } = await readJsonFile(this.file);
    this.state = resolveAppState({ ...DEFAULT_APP_STATE }, value);
    this.warnings = movedTo ? [`app-state.json was damaged and was moved to ${movedTo}; using defaults`] : [];
    return this.get();
  }

  /** problems found while loading (a damaged file) */
  loadWarnings(): string[] {
    return [...this.warnings];
  }

  get(): AppState {
    return { ...this.state };
  }

  async update(patch: unknown): Promise<AppState> {
    await this.queue.run(async () => {
      const next = resolveAppState(this.state, patch);
      await writeJsonFile(this.file, next);
      this.state = next;
    });
    return this.get();
  }
}
