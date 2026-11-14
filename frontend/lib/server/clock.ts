// The only source of time for server code, so tests can freeze and move it.

let frozenAt: number | null = null;

export function now(): Date {
  return new Date(frozenAt ?? Date.now());
}

/** Tests only. Pass null to restore the real clock. */
export function setNow(date: Date | null): void {
  frozenAt = date === null ? null : date.getTime();
}
