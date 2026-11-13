import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttachmentsModule } from '../attachments/attachments.module';
import { SetupModule } from '../setup/setup.module';
import { Distributor, DistributorRate, DistributorRegistrationEvent, Manufacturer, Product } from './catalog.entities';
import { RegistrationController } from './registration.controller';
import { RegistrationService } from './registration.service';
import { RatesService } from './rates.service';
import { DistributorRatesController, DistributorsController, ManufacturersController, ProductsController } from './catalog.controller';
import { DistributorsService, ManufacturersService, ProductsService } from './catalog.service';
import { StockService } from './stock.service';

@Module({
  imports: [TypeOrmModule.forFeature([Product, Manufacturer, Distributor, DistributorRate, DistributorRegistrationEvent]), AttachmentsModule, SetupModule],
  controllers: [ProductsController, ManufacturersController, DistributorsController, DistributorRatesController, RegistrationController],
  providers: [ProductsService, ManufacturersService, DistributorsService, StockService, RatesService, RegistrationService],
  exports: [StockService, ProductsService, ManufacturersService, DistributorsService, RatesService],
})
export class CatalogModule {}
