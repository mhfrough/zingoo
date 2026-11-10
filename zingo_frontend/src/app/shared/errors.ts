import { HttpErrorResponse } from '@angular/common/http';

/** Turns an API error into one readable sentence for a toast or a form notice. */
export function errorText(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return 'Cannot reach the server. Check that the API is running.';
    const msg = err.error?.message;
    if (Array.isArray(msg)) return msg.join('. ');
    if (typeof msg === 'string') return msg;
    if (err.status === 403) return 'Your role does not allow this.';
  }
  return 'Something went wrong. Try again.';
}
