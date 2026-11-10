/**
 * connection-status.ts - the small "Live / Connecting / Offline" pill in the top bar (app-connection-status).
 * Owned by the design-system session. The realtime service feeds it through the CONNECTION_STATUS token.
 */
import { ChangeDetectionStrategy, Component, InjectionToken, Signal, ViewEncapsulation, computed, input } from '@angular/core';

/** The three states of the realtime connection. */
export type ConnectionState = 'connected' | 'connecting' | 'offline';

/**
 * Provide a signal of the realtime status and the top bar shows the pill (without it the pill is hidden):
 * `{ provide: CONNECTION_STATUS, useFactory: () => inject(RealtimeService).status }`
 */
export const CONNECTION_STATUS = new InjectionToken<Signal<ConnectionState>>('CONNECTION_STATUS');

const TEXT: Record<ConnectionState, { label: string; tip: string }> = {
  connected: { label: 'Live', tip: 'Connected: changes from other people appear as they happen.' },
  connecting: { label: 'Connecting', tip: 'Connecting to the server...' },
  offline: { label: 'Offline', tip: 'Offline: showing the last data. Reconnecting automatically.' },
};

/**
 * Dot + word that says whether the live connection is up. The dot pulses while connecting; under 640px only the dot
 * shows (the tooltip and screen-reader text keep the word).
 *
 *   <app-connection-status [status]="realtime.status()" />
 */
@Component({
  selector: 'app-connection-status',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'conn',
    role: 'status',
    '[attr.data-status]': 'status()',
    '[attr.title]': 'text().tip',
    '[attr.aria-label]': 'text().label + ". " + text().tip',
  },
  template: `<span class="conn__dot" aria-hidden="true"></span><span class="conn__label">{{ text().label }}</span>`,
})
export class ConnectionStatus {
  /** current state of the connection */
  readonly status = input<ConnectionState>('connecting');
  protected text = computed(() => TEXT[this.status()]);
}
