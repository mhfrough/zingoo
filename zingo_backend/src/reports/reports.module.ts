import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { DistributionModule } from '../distribution/distribution.module';
import { FinanceModule } from '../finance/finance.module';
import { ManufacturingModule } from '../manufacturing/manufacturing.module';
import { SetupModule } from '../setup/setup.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [CatalogModule, DistributionModule, FinanceModule, ManufacturingModule, SetupModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
