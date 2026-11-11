import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttachmentsModule } from '../attachments/attachments.module';
import { LedgerModule } from '../ledger/ledger.module';
import { SetupModule } from '../setup/setup.module';
import { AccountingController, FinanceController, SettlementsController } from './finance.controller';
import { AccountingDocument, AccountingSettlement, Approval, FinanceEntry, FinanceEntryStream } from './finance.entities';
import { AccountingService, FinanceService } from './finance.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([FinanceEntry, FinanceEntryStream, AccountingDocument, AccountingSettlement, Approval]),
    LedgerModule,
    SetupModule,
    AttachmentsModule,
  ],
  controllers: [FinanceController, AccountingController, SettlementsController],
  providers: [FinanceService, AccountingService],
  exports: [FinanceService, AccountingService],
})
export class FinanceModule {}
