import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExportCostPayment, ExportReceipt, ExportShipment } from './exports.entities';

/** Tables only for now. Endpoints and posting for export containers come in phase 5. */
@Module({
  imports: [TypeOrmModule.forFeature([ExportShipment, ExportReceipt, ExportCostPayment])],
})
export class ExportsModule {}
