import { DestroyRef, Injectable, inject } from '@angular/core';
import { CanActivateChildFn } from '@angular/router';

/**
 * Knows whether any open form has unsaved changes, so nothing typed is lost by accident:
 *  - closing or reloading the browser tab shows the browser's "Leave site?" warning;
 *  - moving to another page (menu link, back button) asks "Discard changes?" first (`unsavedChangesGuard`);
 *  - signing out asks first (the shell calls `confirmLeave()`).
 * Panels (`app-offcanvas`, `app-modal`) register themselves while open; a form on a page registers with `watch()`.
 */
@Injectable({ providedIn: 'root' })
export class UnsavedChanges {
  /** asks "Discard changes?"; ConfirmService plugs its dialog in here (kept apart so the dialog files do not import each other) */
  asker: () => Promise<boolean> = () => Promise.resolve(window.confirm('Discard your unsaved changes?'));
  private sources = new Set<() => boolean>();
  private asking = false;

  constructor() {
    window.addEventListener('beforeunload', (e) => {
      if (!this.any()) return;
      e.preventDefault();
      e.returnValue = ''; // older browsers need a value to show the warning
    });
  }

  /** count `dirty` as unsaved work until the returned function is called (or the caller is destroyed) */
  watch(dirty: () => boolean, destroyRef?: DestroyRef): () => void {
    this.sources.add(dirty);
    const stop = () => this.sources.delete(dirty);
    destroyRef?.onDestroy(stop);
    return stop;
  }

  /** some open form has changes nobody saved */
  any(): boolean {
    for (const dirty of this.sources) if (dirty()) return true;
    return false;
  }

  /** "Discard changes?" for one panel or dialog; resolves true on Discard */
  askDiscard(): Promise<boolean> {
    return this.asker();
  }

  /** true when it is fine to leave: nothing unsaved, or the person chose to discard it */
  async confirmLeave(): Promise<boolean> {
    if (!this.any()) return true;
    if (this.asking) return false;
    this.asking = true;
    try {
      return await this.asker();
    } finally {
      this.asking = false;
    }
  }
}

/** on every page change inside the portal: ask before unsaved changes are lost */
export const unsavedChangesGuard: CanActivateChildFn = () => inject(UnsavedChanges).confirmLeave();
