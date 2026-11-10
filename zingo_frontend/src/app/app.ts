import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ConfirmHost, ToastHost } from './ui';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, ToastHost, ConfirmHost],
  template: `
    <router-outlet />
    <app-toast-host />
    <app-confirm-host />
  `,
})
export class App {}
