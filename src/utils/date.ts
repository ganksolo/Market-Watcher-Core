export const nowISO = (): string => new Date().toISOString();

export const toDateString = (iso: string): string => iso.slice(0, 10);
