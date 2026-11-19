import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
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
import { DistInvoicesController } from './dist-invoices.controller';
import { DistOrderPayment, DistributorInvoice, DistributorInvoiceLine, DistributorInvoicePayment } from './dist-invoices.entities';
import { DistOrderMoneyService } from './dist-order-money.service';
import { DistOrderMoneyController } from './dist-order-money.controller';
import { DistInvoicesService } from './dist-invoices.service';
import { ProductionShipment } from './shipments.entities';
import { ShipmentsService } from './shipments.service';
import { ProductionOrder, ProductionOrderEvent } from './production-orders.entities';
import { ProductionOrdersService } from './production-orders.service';
import { DeliveryClaimsController } from './delivery-claims.controller';
import { DeliveryClaim, DeliveryClaimNote } from './delivery-claims.entities';
import { DeliveryClaimsService } from './delivery-claims.service';
import { DistDispatchesController } from './dist-dispatches.controller';
import { DistributorDispatch } from './dist-dispatches.entities';
import { DistDispatchesService } from './dist-dispatches.service';

@Module({
  imports: [TypeOrmModule.forFeature([ProductionBatch, ManufacturerPayment, ProductionOrder, ProductionOrderEvent, MfrPaymentRequest, MfrRequestPayment, ProductionShipment, DistributorInvoice, DistributorInvoiceLine, DistributorInvoicePayment, DistOrderPayment, DeliveryClaim, DeliveryClaimNote, DistributorDispatch]), LedgerModule, SetupModule, AttachmentsModule],
  controllers: [BatchesController, MfrPaymentsController, ProductionOrdersController, PaymentRequestsController, ShipmentsController, DistInvoicesController, DeliveryClaimsController, DistDispatchesController, DistOrderMoneyController],
  providers: [BatchesService, MfrPaymentsService, ProductionOrdersService, PaymentRequestsService, ShipmentsService, DistInvoicesService, DeliveryClaimsService, DistDispatchesService, DistOrderMoneyService],
  exports: [BatchesService, MfrPaymentsService, ProductionOrdersService, PaymentRequestsService, ShipmentsService, DistInvoicesService, DistOrderMoneyService],
})
export class ManufacturingModule {}
