import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LedgerModule } from '../ledger/ledger.module';
import { SetupModule } from '../setup/setup.module';
import { BatchesController, MfrPaymentsController } from './manufacturing.controller';
import { ManufacturerPayment, ProductionBatch } from './manufacturing.entities';
import { BatchesService, MfrPaymentsService } from './manufacturing.service';
import { PaymentRequestsController } from './payment-requests.controller';
import { MfrPaymentRequest, MfrRequestPayment } from './payment-requests.entities';
import { PaymentRequestsService } from './payment-requests.service';
import { ProductionOrdersController } from './production-orders.controller';
import { ShipmentsController } from './shipments.controller';
import { ProductionShipment } from './shipments.entities';
import { ShipmentsService } from './shipments.service';
import { ProductionOrder, ProductionOrderEvent } from './production-orders.entities';
import { ProductionOrdersService } from './production-orders.service';

@Module({
  imports: [TypeOrmModule.forFeature([ProductionBatch, ManufacturerPayment, ProductionOrder, ProductionOrderEvent, MfrPaymentRequest, MfrRequestPayment, ProductionShipment]), LedgerModule, SetupModule],
  controllers: [BatchesController, MfrPaymentsController, ProductionOrdersController, PaymentRequestsController, ShipmentsController],
  providers: [BatchesService, MfrPaymentsService, ProductionOrdersService, PaymentRequestsService, ShipmentsService],
  exports: [BatchesService, MfrPaymentsService, ProductionOrdersService, PaymentRequestsService, ShipmentsService],
})
export class ManufacturingModule {}
