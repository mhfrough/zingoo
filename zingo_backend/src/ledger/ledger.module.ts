import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SetupModule } from '../setup/setup.module';
import { JournalVoucher, LedgerEntry } from './ledger.entities';
import { LedgerService } from './ledger.service';
import { PostingService } from './posting.service';

@Module({
  imports: [TypeOrmModule.forFeature([LedgerEntry, JournalVoucher]), SetupModule],
  providers: [LedgerService, PostingService],
  exports: [LedgerService, PostingService],
})
export class LedgerModule {}
