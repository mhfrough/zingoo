import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from '../catalog/catalog.module';
import { LedgerModule } from '../ledger/ledger.module';
import { SetupModule } from '../setup/setup.module';
import { ExportsController } from './exports.controller';
import { DistributorAccountController } from './distributor-account.controller';
import { DistributorAccountService } from './distributor-account.service';
import { DistributorRemittance, ExportCostPayment, ExportReceipt, ExportShipment } from './exports.entities';
import { ExportsService } from './exports.service';

/** Export containers: quotes, shipping, foreign-currency collections and logistics payments. */
@Module({
  imports: [TypeOrmModule.forFeature([ExportShipment, ExportReceipt, ExportCostPayment, DistributorRemittance]), CatalogModule, LedgerModule, SetupModule],
  controllers: [ExportsController, DistributorAccountController],
  providers: [ExportsService, DistributorAccountService],
  exports: [ExportsService],
})
export class ExportsModule {}
