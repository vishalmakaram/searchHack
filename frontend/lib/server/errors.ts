// Errors thrown by lib/server. Route handlers turn a DomainError into
// `{ "error": message }` with its status; anything else is a 500.

export type DomainErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 502;

export class DomainError extends Error {
  readonly status: DomainErrorStatus;

  constructor(status: DomainErrorStatus, message: string) {
    super(message);
    this.name = "DomainError";
    this.status = status;
  }
}

/**
 * `instanceof` can fail when a dev-server reload leaves two copies of this
 * module loaded, so this also accepts anything shaped like a DomainError.
 */
export function isDomainError(error: unknown): error is DomainError {
  if (error instanceof DomainError) return true;
  if (typeof error !== "object" || error === null) return false;
  const { name, status, message } = error as Record<string, unknown>;
  return (
    name === "DomainError" &&
    typeof message === "string" &&
    typeof status === "number" &&
    [400, 401, 403, 404, 409, 413, 502].includes(status)
  );
}

export function notFound(kind: string, id: string): DomainError {
  return new DomainError(404, `No ${kind} with id "${id}".`);
}
