const P = (d: string) => () => (
  <svg class="i" viewBox="0 0 16 16" aria-hidden="true">
    <path d={d} />
  </svg>
);

export const IconGear = () => (
  <svg class="i" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1" />
  </svg>
);
export const IconDownload = P('M8 2v8M4.8 7.2 8 10.4l3.2-3.2M2.5 13.5h11');
export const IconCopy = () => (
  <svg class="i" viewBox="0 0 16 16" aria-hidden="true">
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
  </svg>
);
