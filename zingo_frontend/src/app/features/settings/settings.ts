import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { PageHeader, TabItem, TabPanel, Tabs } from '../../ui';
import { SettingsCategories } from './settings-categories';
import { SettingsData } from './settings-data';
import { SettingsGeneral } from './settings-general';
import { SettingsLists } from './settings-lists';
import { SettingsPartners } from './settings-partners';

/**
 * Settings & Data: the one place everything the business may want to change lives, so nothing is fixed in the app.
 * Company and assumptions, the pick-lists (payment methods, Incoterms, containers, currencies), categories and cost
 * centers, manufacturers and distributors, and the data export. Only an Admin can change anything here.
 */
@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader, Tabs, TabPanel, SettingsGeneral, SettingsLists, SettingsCategories, SettingsPartners, SettingsData],
  template: `
    <app-page-header eyebrow="Zingoo · Zen Foods" title="Settings & data"
      description="Everything the business can change lives here: assumptions, lists, currencies, categories and partners." />
    <app-tabs [tabs]="tabs" [(active)]="tab" ariaLabel="Settings sections">
      <ng-template appTabPanel="general"><app-settings-general /></ng-template>
      <ng-template appTabPanel="lists"><app-settings-lists /></ng-template>
      <ng-template appTabPanel="categories"><app-settings-categories /></ng-template>
      <ng-template appTabPanel="partners"><app-settings-partners /></ng-template>
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
    { id: 'partners', label: 'Manufacturers & distributors', icon: 'handshake' },
    { id: 'data', label: 'Data', icon: 'download' },
  ];
}
