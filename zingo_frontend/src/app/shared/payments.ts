/**
 * A cheque is not cash until the bank clears it. Payment methods are a list in Settings, so a method counts as a
 * cheque by its name ("Cheque" or "Check"). The server applies the same rule.
 */
export function isChequeMethod(method: string | null | undefined): boolean {
  return /^(cheque|check)$/i.test((method ?? '').trim());
}
