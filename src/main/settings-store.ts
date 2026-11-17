import path from 'node:path';
import type { SettingsSnapshot } from '../shared/ipc';
import { APP_SETTING_KEYS, DEFAULT_SETTINGS, resolveSettings, type ResolvedSettings, type Settings } from '../shared/settings';
import { isRecord, readJsonFile, writeJsonFile, WriteQueue } from './json-file';

const defaults = (): Settings => structuredClone(DEFAULT_SETTINGS) as Settings;

/**
 * Applies a partial settings object on top of `base`; `detection.thresholds` and `detection.weights` merge key by key.
 * Every value is validated again by resolveSettings: a bad value falls back to its default, with a warning.
 */
export function mergeSettings(base: Settings, patch: unknown): ResolvedSettings {
  if (patch === undefined || patch === null) return resolveSettings(base);
  if (!isRecord(patch)) return { settings: structuredClone(base), warnings: ['Settings must be an object; nothing changed'] };
  const merged: Record<string, unknown> = { ...structuredClone(base), ...patch };
  if (isRecord(patch.detection)) {
    const d = patch.detection;
    merged.detection = {
      thresholds: { ...base.detection.thresholds, ...(isRecord(d.thresholds) ? d.thresholds : {}) },
      weights: { ...base.detection.weights, ...(isRecord(d.weights) ? d.weights : {}) },
    };
  }
  return resolveSettings(merged);
}

/** A per-job patch without the app-level keys (APP_SETTING_KEYS); anything that is not an object is returned as is. */
export function withoutAppSettings(patch: unknown): unknown {
  if (!isRecord(patch)) return patch;
  const out: Record<string, unknown> = { ...patch };
  for (const key of APP_SETTING_KEYS) delete out[key];
  return out;
}

/** The values that differ from the defaults. Only these are saved, so later default changes reach everyone else. */
export function settingsOverrides(settings: Settings): Partial<Settings> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(settings) as (keyof Settings)[]) {
    if (JSON.stringify(settings[key]) !== JSON.stringify(DEFAULT_SETTINGS[key])) out[key] = settings[key];
  }
  return out as Partial<Settings>;
}

/** The saved settings (userData/settings.json, spec section 6). */
export class SettingsStore {
  private current: Settings = defaults();
  private loadWarnings: string[] = [];
  private readonly queue = new WriteQueue();

  constructor(private readonly file: string) {}

  static fileIn(dir: string): string {
    return path.join(dir, 'settings.json');
  }

  async load(): Promise<SettingsSnapshot> {
    const { value, movedTo } = await readJsonFile(this.file);
    const { settings, warnings } = resolveSettings(value);
    this.current = settings;
    this.loadWarnings = movedTo ? [`settings.json was damaged and was moved to ${movedTo}; using defaults`, ...warnings] : warnings;
    return this.snapshot();
  }

  /** a copy of the saved settings */
  get(): Settings {
    return structuredClone(this.current);
  }

  /** without arguments, carries the warnings found while loading */
  snapshot(warnings: string[] = this.loadWarnings): SettingsSnapshot {
    return { settings: this.get(), defaults: defaults(), warnings: [...warnings] };
  }

  async update(patch: unknown): Promise<SettingsSnapshot> {
    let warnings: string[] = [];
    await this.queue.run(async () => {
      const merged = mergeSettings(this.current, patch);
      await writeJsonFile(this.file, settingsOverrides(merged.settings));
      this.current = merged.settings;
      warnings = merged.warnings;
    });
    return this.snapshot(warnings);
  }

  async reset(): Promise<SettingsSnapshot> {
    await this.queue.run(async () => {
      const next = defaults();
      await writeJsonFile(this.file, settingsOverrides(next));
      this.current = next;
    });
    return this.snapshot([]);
  }
}
