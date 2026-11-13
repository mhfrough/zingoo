import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from '../catalog/catalog.module';
import { LedgerModule } from '../ledger/ledger.module';
import { SetupModule } from '../setup/setup.module';
import { ExportsController } from './exports.controller';
import { DistributorAccountController } from './distributor-account.controller';
import { DistributorAccountService } from './distributor-account.service';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';
import { DistributorRemittance, ExportClaim, ExportCostPayment, ExportReceipt, ExportShipment, ProductMarketApproval, RemittanceAdvice } from './exports.entities';
import { AttachmentsModule } from '../attachments/attachments.module';
import { ExportsService } from './exports.service';

/** Export containers: quotes, shipping, foreign-currency collections and logistics payments. */
@Module({
  imports: [TypeOrmModule.forFeature([ExportShipment, ExportReceipt, ExportCostPayment, DistributorRemittance, ExportClaim, ProductMarketApproval, RemittanceAdvice]), AttachmentsModule, CatalogModule, LedgerModule, SetupModule],
  controllers: [ExportsController, DistributorAccountController, ComplianceController],
  providers: [ExportsService, DistributorAccountService, ComplianceService],
  exports: [ExportsService, ComplianceService, DistributorAccountService],
})
export class ExportsModule {}
