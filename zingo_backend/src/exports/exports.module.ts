import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from '../catalog/catalog.module';
import { LedgerModule } from '../ledger/ledger.module';
import { SetupModule } from '../setup/setup.module';
import { ExportsController } from './exports.controller';
import { ExportCostPayment, ExportReceipt, ExportShipment } from './exports.entities';
import { ExportsService } from './exports.service';

/** Export containers: quotes, shipping, foreign-currency collections and logistics payments. */
@Module({
  imports: [TypeOrmModule.forFeature([ExportShipment, ExportReceipt, ExportCostPayment]), CatalogModule, LedgerModule, SetupModule],
  controllers: [ExportsController],
  providers: [ExportsService],
  exports: [ExportsService],
})
export class ExportsModule {}
