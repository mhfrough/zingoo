import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SetupController } from './setup.controller';
import { Account, Category, ContainerType, Currency, Setting } from './setup.entities';
import { AccountsService, CatalogListsService, CategoriesService, SettingsService } from './setup.service';

@Module({
  imports: [TypeOrmModule.forFeature([Setting, Currency, Account, Category, ContainerType])],
  controllers: [SetupController],
  providers: [SettingsService, AccountsService, CategoriesService, CatalogListsService],
  exports: [SettingsService, AccountsService, CategoriesService],
})
export class SetupModule {}
