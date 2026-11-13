import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, Validators } from '@angular/forms';
import { Btn, Field, Offcanvas } from '../../ui';
import { FormModal } from '../ops/form-modal';
import { Distributor, Manufacturer } from '../ops/models';
import { ROLE_LIST, UserRow, UsersApi } from './users.api';

/**
 * Add a login or change one. The signing seat only matters for Admin and Finance (they can approve spending);
 * a Distributor login must belong to one distributor. The root account keeps its role, seat and status.
 */
@Component({
  selector: 'app-user-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Offcanvas, Field, Btn],
  template: `
    <app-offcanvas #oc [(open)]="open" [title]="user() ? 'Edit user' : 'Add user'"
               [subtitle]="user() ? user()!.email : 'They sign in with this email and password.'" size="lg" [dirty]="form.dirty">
      @if (error()) {
        <div class="notice" data-tone="danger" role="alert">{{ error() }}</div>
      }
      <form [id]="formId" [formGroup]="form" (ngSubmit)="submit()" class="form-grid" novalidate>
        <app-field label="Full name" [required]="true" [error]="invalid('name') ? 'Enter the name' : null"><input type="text" formControlName="name" maxlength="120" autocomplete="off" /></app-field>
        <app-field label="Email" [required]="true" [error]="invalid('email') ? 'Enter a valid email' : null"><input type="email" formControlName="email" autocomplete="off" /></app-field>
        <app-field label="Role" [required]="true" [hint]="locked() ? 'The root account is always Admin' : ''">
          <select formControlName="role">
            @for (r of roles; track r) {
              <option [value]="r">{{ r }}</option>
            }
          </select>
        </app-field>
        @if (canSign()) {
          <app-field label="Signing seat" hint="Which approval signature they can give">
            <select formControlName="seat">
              <option value="None">None</option>
              <option value="A">Seat A</option>
              <option value="B">Seat B</option>
              <option value="Both">Both seats</option>
            </select>
          </app-field>
        }
        @if (isDistributor()) {
          <app-field label="Distributor" [required]="true" [error]="invalid('distributorId') ? 'Choose the distributor' : null">
            <select formControlName="distributorId">
              <option value="">Choose a distributor</option>
              @for (d of distributors(); track d.id) {
                <option [value]="d.id">{{ d.name }}</option>
              }
            </select>
          </app-field>
        }
        @if (isDistributor()) {
          <app-field label="Portal role" hint="Owner does everything; Sales orders and claims; Finance payments; Warehouse receipts and claims; Read-only looks">
            <select formControlName="portalRole">
              @for (r of portalRoles; track r) { <option [value]="r">{{ r }}</option> }
            </select>
          </app-field>
        }
        @if (isManufacturer()) {
          <app-field label="Manufacturer" [required]="true" [error]="invalid('manufacturerId') ? 'Choose the manufacturer' : null">
            <select formControlName="manufacturerId">
              <option value="">Choose a manufacturer</option>
              @for (m of manufacturers(); track m.id) {
                <option [value]="m.id">{{ m.name }}</option>
              }
            </select>
          </app-field>
        }
        @if (user()) {
          <app-field label="Status" [hint]="locked() ? 'The root account cannot be switched off' : ''">
            <select formControlName="status">
              <option value="Active">Active</option>
              <option value="Disabled">Disabled</option>
            </select>
          </app-field>
        } @else {
          <app-field label="Password" hint="At least 8 characters" [required]="true" [error]="invalid('password') ? 'Use at least 8 characters' : null">
            <input type="password" formControlName="password" autocomplete="new-password" />
          </app-field>
        }
      </form>
      <ng-container offcanvasFooter>
        <button appBtn type="button" (click)="oc.requestClose()">Cancel</button>
        <button appBtn variant="primary" type="submit" [attr.form]="formId" icon="check" [loading]="busy()">
          {{ user() ? 'Save user' : 'Add user' }}
        </button>
      </ng-container>
    </app-offcanvas>
  `,
})
export class UserForm extends FormModal {
  readonly user = input<UserRow | null>(null);
  readonly distributors = input<Distributor[]>([]);
  readonly manufacturers = input<Manufacturer[]>([]);
  readonly formId = 'form-user';
  protected roles = ROLE_LIST;
  private usersApi = inject(UsersApi);

  protected portalRoles = ['Owner', 'Sales', 'Finance', 'Warehouse', 'Read-only'];
  readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    role: ['Viewer'],
    seat: ['None'],
    distributorId: [''],
    manufacturerId: [''],
    portalRole: ['Owner'],
    status: ['Active'],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  private value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected canSign = computed(() => ['Admin', 'Finance'].includes(this.value().role ?? ''));
  protected isDistributor = computed(() => this.value().role === 'Distributor');
  protected isManufacturer = computed(() => this.value().role === 'Manufacturer');
  protected locked = computed(() => !!this.user()?.isRoot);

  protected reset() {
    const u = this.user();
    this.form.reset({
      name: u?.name ?? '', email: u?.email ?? '', role: u?.role ?? 'Viewer', seat: u?.seat ?? 'None',
      distributorId: u?.distributorId ?? '', manufacturerId: u?.manufacturerId ?? '', portalRole: u?.portalRole ?? 'Owner', status: u?.status ?? 'Active', password: '',
    });
    const editing = !!u;
    // an existing login keeps its email; a password is only asked for when adding
    this.toggle('email', !editing);
    this.toggle('password', !editing);
    // the root account keeps its role, seat and status
    this.toggle('role', !u?.isRoot);
    this.toggle('status', !u?.isRoot);
  }

  private toggle(name: 'email' | 'password' | 'role' | 'status', on: boolean) {
    const c = this.form.controls[name];
    if (on) c.enable({ emitEvent: false });
    else c.disable({ emitEvent: false });
  }

  protected request() {
    const v = this.form.getRawValue();
    const u = this.user();
    const seat = this.canSign() ? v.seat : 'None';
    const distributorId = this.isDistributor() ? v.distributorId : null;
    const manufacturerId = this.isManufacturer() ? v.manufacturerId : null;
    return u
      ? this.usersApi.update(u.id, { name: v.name, ...(u.isRoot ? {} : { role: v.role, status: v.status }), seat, distributorId, manufacturerId, ...(distributorId ? { portalRole: v.portalRole } : {}) })
      : this.usersApi.create({
        name: v.name, email: v.email, password: v.password, role: v.role, seat,
        ...(distributorId ? { distributorId, portalRole: v.portalRole } : {}), ...(manufacturerId ? { manufacturerId } : {}),
      });
  }

  protected successMessage() {
    return this.user() ? 'User saved.' : 'User added. They can sign in now.';
  }
}
