import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from '../catalog/catalog.module';
import { LedgerModule } from '../ledger/ledger.module';
import { SetupModule } from '../setup/setup.module';
import { CollectionsController, OrdersController } from './distribution.controller';
import { Collection, SalesOrder } from './distribution.entities';
import { CollectionsService, OrdersService } from './distribution.service';

@Module({
  imports: [TypeOrmModule.forFeature([SalesOrder, Collection]), LedgerModule, SetupModule, CatalogModule],
  controllers: [OrdersController, CollectionsController],
  providers: [OrdersService, CollectionsService],
  exports: [OrdersService, CollectionsService],
})
export class DistributionModule {}
