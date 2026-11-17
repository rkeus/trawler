import { useState } from 'react';
import { PALETTES, THEMES, type AppState, type SettingsSnapshot } from '../../shared/ipc';
import { errorText } from '../api';
import { Field } from '../components/Field';
import { PALETTE_LABEL, PALETTE_SWATCH } from '../components/palettes';
import { Seg } from '../components/Seg';
import { useApp } from '../state/AppProvider';
import { buildPatch, FIELDS, toDraft, type Draft, type FieldGroup } from '../state/settings-form';

const THEME_OPTIONS = THEMES.map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }));

const GROUPS: { id: FieldGroup; title: string; note?: string }[] = [
  { id: 'download', title: 'Download' },
  { id: 'js', title: 'JS mode' },
  { id: 'application', title: 'Application', note: 'App-wide. A single job (for example Repeat) never changes these.' },
  { id: 'detection', title: 'Detection (advanced)' },
];

function GroupFields({ group, draft, errors, set }: { group: FieldGroup; draft: Draft; errors: Record<string, string>; set: (key: string, v: string | boolean) => void }) {
  return (
    <div className="fields">
      {FIELDS.filter((f) => f.group === group).map((spec) => (
        <Field key={spec.key} spec={spec} value={draft[spec.key]} error={errors[spec.key]} onChange={(v) => set(spec.key, v)} />
      ))}
    </div>
  );
}

export function SettingsScreen() {
  const { model, api, dispatch } = useApp();
  const saved = model.settings!.settings;
  const appState = model.appState!;
  const [draft, setDraft] = useState<Draft>(() => toDraft(saved));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<string[]>([]);
  const [failure, setFailure] = useState('');
  const hasDetectionError = Object.keys(errors).some((k) => k.startsWith('detection.'));
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(saved));

  function set(key: string, value: string | boolean): void {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function applied(snapshot: SettingsSnapshot, fallbackNote: string): void {
    dispatch({ type: 'settings', snapshot });
    setDraft(toDraft(snapshot.settings));
    setNotes(snapshot.warnings.length > 0 ? snapshot.warnings : [fallbackNote]);
  }

  async function save(): Promise<void> {
    setFailure('');
    const built = buildPatch(draft, saved);
    if (!built.ok) {
      setErrors(built.errors);
      setNotes(['Fix the marked fields.']);
      return;
    }
    setErrors({});
    try {
      applied(await api.updateSettings(built.patch), 'Saved.');
    } catch (err) {
      setFailure(errorText(err));
    }
  }

  async function reset(): Promise<void> {
    setFailure('');
    setErrors({});
    try {
      applied(await api.resetSettings(), 'Back to the defaults.');
    } catch (err) {
      setFailure(errorText(err));
    }
  }

  async function appearance(patch: Partial<AppState>): Promise<void> {
    setFailure('');
    try {
      dispatch({ type: 'app-state', state: await api.updateAppState(patch) });
    } catch (err) {
      setFailure(errorText(err));
    }
  }

  return (
    <>
      <h1>Settings</h1>
      {failure && (
        <div className="glass notice err" role="alert">
          {failure}
        </div>
      )}
      {GROUPS.map((g) => (
        <div key={g.id}>
          {g.id === 'application' && (
            <div className="glass card" style={{ marginTop: 12 }}>
              <div className="cap" style={{ marginTop: 0 }}>Appearance</div>
              <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <div className="hint">Theme</div>
                  <Seg options={THEME_OPTIONS} value={appState.theme} onChange={(theme) => void appearance({ theme })} label="Theme" />
                </div>
                <div>
                  <div className="hint">Accent</div>
                  <div className="swatches" role="group" aria-label="Accent" style={{ marginTop: 4 }}>
                    {PALETTES.map((p) => (
                      <button
                        key={p}
                        type="button"
                        className={p === appState.palette ? 'swatch on' : 'swatch'}
                        style={{ background: PALETTE_SWATCH[p] }}
                        title={PALETTE_LABEL[p]}
                        aria-label={PALETTE_LABEL[p]}
                        aria-pressed={p === appState.palette}
                        onClick={() => void appearance({ palette: p })}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
          <div className="glass card" style={{ marginTop: 12 }}>
            {g.id === 'detection' ? (
              <details className="group" open={hasDetectionError || undefined}>
                <summary>{g.title}</summary>
                <div style={{ marginTop: 10 }}>
                  <GroupFields group={g.id} draft={draft} errors={errors} set={set} />
                </div>
              </details>
            ) : (
              <>
                <div className="cap" style={{ marginTop: 0 }}>{g.title}</div>
                <GroupFields group={g.id} draft={draft} errors={errors} set={set} />
                {g.note && <div className="hint" style={{ marginTop: 6 }}>{g.note}</div>}
              </>
            )}
          </div>
        </div>
      ))}
      {notes.length > 0 && (
        <div className="glass notice" role="status" style={{ marginTop: 12 }}>
          <span className="grow">
            {notes.map((n, i) => (
              <div key={i}>{n}</div>
            ))}
          </span>
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn go" disabled={!dirty} onClick={() => void save()}>
          Save
        </button>
        <button type="button" className="btn" onClick={() => void reset()}>
          Reset to defaults
        </button>
      </div>
    </>
  );
}
