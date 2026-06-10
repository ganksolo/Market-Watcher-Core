export function prettifyErrorMessage(raw: string): string {
  if (raw === 'n/a') return raw;
  return raw
    .replace(/^db(?=_)/, 'DB')
    .replace(/^api(?=_)/, 'API')
    .replace(/_/g, ' ')
    .replace(/^./, c => c.toUpperCase());
}
