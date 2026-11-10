import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SetupModule } from '../setup/setup.module';
import { JournalVoucher, LedgerEntry } from './ledger.entities';
import { LedgerService } from './ledger.service';
import { PostingService } from './posting.service';
import { VouchersController } from './vouchers.controller';
import { VouchersService } from './vouchers.service';

/** The journal, the posting rules and manual journal vouchers. */
@Module({
  imports: [TypeOrmModule.forFeature([LedgerEntry, JournalVoucher]), SetupModule],
  controllers: [VouchersController],
  providers: [LedgerService, PostingService, VouchersService],
  exports: [LedgerService, PostingService, VouchersService],
})
export class LedgerModule {}
