import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LedgerModule } from '../ledger/ledger.module';
import { SetupModule } from '../setup/setup.module';
import { BatchesController, MfrPaymentsController } from './manufacturing.controller';
import { ManufacturerPayment, ProductionBatch } from './manufacturing.entities';
import { BatchesService, MfrPaymentsService } from './manufacturing.service';
import { ProductionOrdersController } from './production-orders.controller';
import { ProductionOrder, ProductionOrderEvent } from './production-orders.entities';
import { ProductionOrdersService } from './production-orders.service';

@Module({
  imports: [TypeOrmModule.forFeature([ProductionBatch, ManufacturerPayment, ProductionOrder, ProductionOrderEvent]), LedgerModule, SetupModule],
  controllers: [BatchesController, MfrPaymentsController, ProductionOrdersController],
  providers: [BatchesService, MfrPaymentsService, ProductionOrdersService],
  exports: [BatchesService, MfrPaymentsService, ProductionOrdersService],
})
export class ManufacturingModule {}
