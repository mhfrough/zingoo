/**
 * Zingoo OS · ERP & Distributor Partner Portal for Zen Foods
 * Owner: Mudassir Jokhio, CEO, Arittek
 * Designed, built and developed by Mohammad Hamza
 *   GitHub:  https://github.com/mhfrough
 *   Website: https://mhfrough.dev/?utm_source=zingoo&utm_medium=referral&utm_campaign=built_by&utm_content=frontend_source
 */
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
