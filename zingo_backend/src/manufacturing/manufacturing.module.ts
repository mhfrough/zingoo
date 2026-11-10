import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LedgerModule } from '../ledger/ledger.module';
import { SetupModule } from '../setup/setup.module';
import { BatchesController, MfrPaymentsController } from './manufacturing.controller';
import { ManufacturerPayment, ProductionBatch } from './manufacturing.entities';
import { BatchesService, MfrPaymentsService } from './manufacturing.service';

@Module({
  imports: [TypeOrmModule.forFeature([ProductionBatch, ManufacturerPayment]), LedgerModule, SetupModule],
  controllers: [BatchesController, MfrPaymentsController],
  providers: [BatchesService, MfrPaymentsService],
  exports: [BatchesService, MfrPaymentsService],
})
export class ManufacturingModule {}
