export function OrinonuMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
      <path className="mark-halo" d="M52 43A24 24 0 1 0 12 43" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path className="mark-flame" d="M32 13C26 20 21 25 21 33c0 7 5 13 11 17 6-4 11-10 11-17 0-8-5-13-11-20Z" stroke="currentColor" strokeWidth="2.8" strokeLinejoin="round" />
      <path className="mark-circuit" d="M32 24v17m-8-10 8 7 8-7M10 45h7l7 7m30-7h-7l-7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle className="mark-node" cx="32" cy="6" r="2.5" fill="currentColor" />
    </svg>
  );
}
