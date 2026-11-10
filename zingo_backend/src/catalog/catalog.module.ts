import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Distributor, DistributorRate, Manufacturer, Product } from './catalog.entities';
import { RatesService } from './rates.service';
import { DistributorRatesController, DistributorsController, ManufacturersController, ProductsController } from './catalog.controller';
import { DistributorsService, ManufacturersService, ProductsService } from './catalog.service';
import { StockService } from './stock.service';

@Module({
  imports: [TypeOrmModule.forFeature([Product, Manufacturer, Distributor, DistributorRate])],
  controllers: [ProductsController, ManufacturersController, DistributorsController, DistributorRatesController],
  providers: [ProductsService, ManufacturersService, DistributorsService, StockService, RatesService],
  exports: [StockService, ProductsService, ManufacturersService, DistributorsService, RatesService],
})
export class CatalogModule {}
