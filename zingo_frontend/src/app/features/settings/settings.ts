import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { PageHeader, TabItem, TabPanel, Tabs } from '../../ui';
import { SettingsCategories } from './settings-categories';
import { SettingsData } from './settings-data';
import { SettingsGeneral } from './settings-general';
import { SettingsLists } from './settings-lists';
import { SettingsPartners } from './settings-partners';
import { ProductsPanel } from '../products/products-panel';

/**
 * Settings & Data: the one place everything the business may want to change lives, so nothing is fixed in the app.
 * Company and assumptions, the pick-lists (payment methods, Incoterms, containers, currencies), categories and cost
 * centers, products, manufacturers and distributors, and the data export. Only an Admin can change anything here.
 */
@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader, Tabs, TabPanel, SettingsGeneral, SettingsLists, SettingsCategories, SettingsPartners, SettingsData, ProductsPanel],
  template: `
    <app-page-header eyebrow="Zingoo · Zen Foods" title="Settings & data"
      description="Everything the business can change lives here: assumptions, lists, currencies, categories and partners." />
    <app-tabs [tabs]="tabs" [(active)]="tab" ariaLabel="Settings sections">
      <ng-template appTabPanel="general"><app-settings-general /></ng-template>
      <ng-template appTabPanel="lists"><app-settings-lists /></ng-template>
      <ng-template appTabPanel="categories"><app-settings-categories /></ng-template>
      <ng-template appTabPanel="products"><app-products-panel /></ng-template>
      <ng-template appTabPanel="manufacturers"><app-settings-partners section="manufacturers" /></ng-template>
      <ng-template appTabPanel="distributors"><app-settings-partners section="distributors" /></ng-template>
      <ng-template appTabPanel="investors"><app-settings-lists section="investors" /></ng-template>
      <ng-template appTabPanel="data"><app-settings-data /></ng-template>
    </app-tabs>
  `,
})
export class Settings {
  protected tab = signal('general');
  protected tabs: TabItem[] = [
    { id: 'general', label: 'Company & assumptions', icon: 'settings' },
    { id: 'lists', label: 'Lists & currencies', icon: 'list' },
    { id: 'categories', label: 'Categories & cost centers', icon: 'landmark' },
    { id: 'products', label: 'Products', icon: 'package' },
    { id: 'manufacturers', label: 'Manufacturers', icon: 'factory' },
    { id: 'distributors', label: 'Distributors', icon: 'truck' },
    { id: 'investors', label: 'Investor accounts', icon: 'users' },
    { id: 'data', label: 'Data', icon: 'download' },
  ];
}
