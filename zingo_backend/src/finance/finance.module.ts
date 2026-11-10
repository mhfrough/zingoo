import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LedgerModule } from '../ledger/ledger.module';
import { SetupModule } from '../setup/setup.module';
import { AccountingController, FinanceController, SettlementsController } from './finance.controller';
import { AccountingDocument, AccountingSettlement, Approval, FinanceEntry } from './finance.entities';
import { AccountingService, FinanceService } from './finance.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([FinanceEntry, AccountingDocument, AccountingSettlement, Approval]),
    LedgerModule,
    SetupModule,
  ],
  controllers: [FinanceController, AccountingController, SettlementsController],
  providers: [FinanceService, AccountingService],
  exports: [FinanceService, AccountingService],
})
export class FinanceModule {}
