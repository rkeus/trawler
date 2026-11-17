import type { DraftValue, FieldSpec } from '../state/settings-form';
import { Switch } from './Switch';

/** One settings field: switch, select, text area or input, with its label, hint and error. */
export function Field({
  spec,
  value,
  error,
  recommended,
  onChange,
}: {
  spec: FieldSpec;
  value: DraftValue | undefined;
  error?: string | undefined;
  /** the analysis recommends a change to this field */
  recommended?: boolean;
  onChange: (value: DraftValue) => void;
}) {
  const id = `f-${spec.key}`;
  const text = typeof value === 'string' ? value : '';
  const note = recommended ? <span className="rec">recommended</span> : null;
  let control;
  switch (spec.kind) {
    case 'bool':
      control = (
        <>
          <Switch checked={value === true} onChange={onChange}>
            {spec.label}
          </Switch>
          {note}
        </>
      );
      break;
    case 'select':
      control = (
        <select id={id} value={text} onChange={(e) => onChange(e.target.value)}>
          {spec.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    case 'lines':
      control = <textarea id={id} rows={3} spellCheck={false} value={text} onChange={(e) => onChange(e.target.value)} />;
      break;
    default:
      control = (
        <input
          id={id}
          spellCheck={false}
          inputMode={spec.kind === 'int' || spec.kind === 'number' ? 'decimal' : 'text'}
          placeholder={spec.placeholder}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
  return (
    <div className="field">
      {spec.kind !== 'bool' && (
        <label htmlFor={id}>
          {spec.label}
          {note}
        </label>
      )}
      {control}
      {spec.hint && !error && <div className="hint">{spec.hint}</div>}
      {error && (
        <div className="er hint" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
