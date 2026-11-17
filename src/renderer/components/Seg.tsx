export interface SegOption<T extends string> {
  value: T;
  label: string;
}

/** A small segmented choice (radio group). */
export function Seg<T extends string>({
  options,
  value,
  onChange,
  label,
  disabled,
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="seg glass" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'on' : ''}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
