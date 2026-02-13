export function SubtlePattern() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.03]" aria-hidden="true">
      <defs>
        <pattern id="grid-pattern" width="40" height="40" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="1" fill="currentColor" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid-pattern)" />
    </svg>
  );
}
