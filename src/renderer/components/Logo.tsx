export function LogoMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="1.75 -3 48 54" aria-hidden="true">
      <path d="M16.75 12l-10 9 10 9" />
      <path d="M34.75 12l10 9-10 9" />
      <circle cx="30.6" cy="1.5" r="2" />
      <path d="M30.1 3.5L21.5 38a5.5 5.5 0 0010.6 2.6l1.4-4.6" />
      <path d="M33.5 36l-3.6 1.6" />
    </svg>
  );
}
