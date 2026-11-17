import type { ReactNode } from 'react';

export function Switch({
  checked,
  onChange,
  disabled,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="switch-row" disabled={disabled} onClick={() => onChange(!checked)}>
      <span className="sw" data-on={checked} />
      <span>{children}</span>
    </button>
  );
}
