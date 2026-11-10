import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { Btn, Field, IconComponent, PasswordField } from '../ui';

const REMEMBER_KEY = 'zingoo.rememberedEmail';

function readRemembered(): string {
  try {
    return localStorage.getItem(REMEMBER_KEY) ?? '';
  } catch {
    return ''; // storage blocked (private window): the form just starts empty
  }
}

function writeRemembered(email: string | null) {
  try {
    if (email) localStorage.setItem(REMEMBER_KEY, email);
    else localStorage.removeItem(REMEMBER_KEY);
  } catch {
    /* ignore */
  }
}

/** Sign-in: navy brand side + form side (styles/components/auth.css). */
@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Btn, Field, IconComponent, PasswordField],
  templateUrl: './login.html',
})
export class Login {
  private auth = inject(AuthService);
  private router = inject(Router);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private password = viewChild(PasswordField);

  protected loading = signal(false);
  protected error = signal('');

  private remembered = readRemembered();

  protected form = inject(FormBuilder).nonNullable.group({
    email: [this.remembered, [Validators.required, Validators.email]],
    password: ['', Validators.required],
    remember: [!!this.remembered],
  });

  protected emailError() {
    const c = this.form.controls.email;
    if (!c.touched || c.valid) return null;
    return c.hasError('required') ? 'Enter your email address' : 'Enter a valid email address';
  }

  protected passwordError() {
    const c = this.form.controls.password;
    return c.touched && c.invalid ? 'Enter your password' : null;
  }

  protected submit() {
    if (this.loading()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      // move to the first field that needs attention
      if (this.form.controls.email.invalid) this.host.nativeElement.querySelector<HTMLInputElement>('input[type=email]')?.focus();
      else this.password()?.focus();
      return;
    }
    this.error.set('');
    this.loading.set(true);
    const { email, password, remember } = this.form.getRawValue();
    this.auth.login(email, password).subscribe({
      next: () => {
        writeRemembered(remember ? email : null);
        this.router.navigate(['/admin/overview']);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err.status === 401 ? 'Wrong email or password.' : 'Cannot reach the server. Try again.');
        this.password()?.focus();
      },
    });
  }
}
