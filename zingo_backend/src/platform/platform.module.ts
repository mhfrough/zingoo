import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Attachment } from '../attachments/attachment.entity';
import { CompaniesModule } from '../companies/companies.module';
import { SetupModule } from '../setup/setup.module';
import { PlatformController } from './platform.controller';

/** The platform (Zingoo) details and the super admin's tools. */
@Module({
  imports: [TypeOrmModule.forFeature([Attachment]), SetupModule, CompaniesModule],
  controllers: [PlatformController],
})
export class PlatformModule {}
