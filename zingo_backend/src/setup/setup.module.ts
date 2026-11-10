import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LookupsService } from './lookups.service';
import { SetupController } from './setup.controller';
import { Account, Category, ContainerType, Currency, Lookup, Setting } from './setup.entities';
import { AccountsService, CatalogListsService, CategoriesService, SettingsService } from './setup.service';

/** Everything the client controls from Settings & Data: assumptions, currencies, containers, lists and categories. */
@Module({
  imports: [TypeOrmModule.forFeature([Setting, Currency, Account, Category, ContainerType, Lookup])],
  controllers: [SetupController],
  providers: [SettingsService, AccountsService, CategoriesService, CatalogListsService, LookupsService],
  exports: [SettingsService, AccountsService, CategoriesService, LookupsService],
})
export class SetupModule {}
