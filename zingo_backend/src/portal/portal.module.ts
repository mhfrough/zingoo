import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DistributionModule } from '../distribution/distribution.module';
import { LedgerModule } from '../ledger/ledger.module';
import { SetupModule } from '../setup/setup.module';
import { PortalController } from './portal.controller';
import { AuditLog, CargoReceipt, CreditNote, PaymentAdvice, PortalRequest } from './portal.entities';
import { PortalService } from './portal.service';

/** The distributor partner portal: requests, deliveries and claims, payment advices, statements and the staff approval desk. */
@Module({
  imports: [
    TypeOrmModule.forFeature([PortalRequest, CargoReceipt, PaymentAdvice, CreditNote, AuditLog]),
    DistributionModule, LedgerModule, SetupModule,
  ],
  controllers: [PortalController],
  providers: [PortalService],
})
export class PortalModule {}
