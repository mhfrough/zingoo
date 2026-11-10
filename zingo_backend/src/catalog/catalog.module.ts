import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Distributor, DistributorRate, Manufacturer, Product } from './catalog.entities';
import { DistributorsController, ManufacturersController, ProductsController } from './catalog.controller';
import { DistributorsService, ManufacturersService, ProductsService } from './catalog.service';
import { StockService } from './stock.service';

@Module({
  imports: [TypeOrmModule.forFeature([Product, Manufacturer, Distributor, DistributorRate])],
  controllers: [ProductsController, ManufacturersController, DistributorsController],
  providers: [ProductsService, ManufacturersService, DistributorsService, StockService],
  exports: [StockService, ProductsService, ManufacturersService, DistributorsService],
})
export class CatalogModule {}
