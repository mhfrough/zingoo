import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog, CargoReceipt, CreditNote, PaymentAdvice, PortalRequest } from './portal.entities';

/** Tables only for now. The distributor self-service flows come in phase 7. */
@Module({
  imports: [TypeOrmModule.forFeature([PortalRequest, CargoReceipt, PaymentAdvice, CreditNote, AuditLog])],
})
export class PortalModule {}
