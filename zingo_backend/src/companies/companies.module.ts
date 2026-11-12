import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SetupModule } from '../setup/setup.module';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { Company } from './company.entity';

/** The companies of the group, kept on Settings & Data. */
@Module({
  imports: [TypeOrmModule.forFeature([Company]), SetupModule],
  controllers: [CompaniesController],
  providers: [CompaniesService],
})
export class CompaniesModule {}
