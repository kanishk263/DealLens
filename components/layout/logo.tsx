export function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
        <rect x="1" y="1" width="22" height="22" rx="5" fill="#1d3b6e" />
        <path d="M6 16.5 10 12l3 2.5 5-6" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {compact ? null : <span className="text-[15px] font-semibold tracking-tight text-ink">DealLens</span>}
    </span>
  );
}
