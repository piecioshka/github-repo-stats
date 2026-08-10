/** Normalizes an unknown thrown value to a printable message. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
