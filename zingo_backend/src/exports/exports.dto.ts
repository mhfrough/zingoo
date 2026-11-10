import { PartialType } from '@nestjs/swagger';
import {
  IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Min,
} from 'class-validator';

/** A container quote. Costs are in the invoice currency. */
export class CreateExportDto {
  @IsDateString() date: string;
  @IsString() @IsNotEmpty() buyer: string;
  @IsString() @IsNotEmpty() country: string;
  @IsOptional() @IsString() port?: string;
  @IsString() @IsNotEmpty() container: string;
  @IsString() @IsNotEmpty() incoterm: string;
  @IsUUID() productId: string;
  @IsInt() @Min(1) cartons: number;
  @IsString() @IsNotEmpty() currency: string;
  /** PKR per 1 unit of the invoice currency */
  @IsNumber() @IsPositive() fxRate: number;
  /** selling price per pack, in the invoice currency */
  @IsNumber() @Min(0) rate: number;
  @IsOptional() @IsNumber() @Min(0) inland?: number;
  @IsOptional() @IsNumber() @Min(0) origin?: number;
  @IsOptional() @IsNumber() @Min(0) documentation?: number;
  @IsOptional() @IsNumber() @Min(0) ocean?: number;
  @IsOptional() @IsNumber() @Min(0) insurance?: number;
  @IsOptional() @IsNumber() @Min(0) destination?: number;
  @IsOptional() @IsNumber() @Min(0) duty?: number;
  @IsOptional() @IsNumber() @Min(0) bankFees?: number;
  @IsOptional() @IsNumber() @Min(0) otherCosts?: number;
}
export class UpdateExportDto extends PartialType(CreateExportDto) {}

/** Ship a quote; the date defaults to today. */
export class ShipExportDto {
  @IsOptional() @IsDateString() shipDate?: string;
}

/** Foreign-currency money received from the buyer. */
export class ExportReceiptDto {
  @IsDateString() date: string;
  @IsNumber() @IsPositive() foreignAmount: number;
  /** PKR per 1 unit on the day the money arrived */
  @IsNumber() @IsPositive() fxRate: number;
  @IsOptional() @IsString() method?: string;
  @IsOptional() @IsString() note?: string;
}

/** PKR paid for the seller-side logistics costs. */
export class ExportCostPaymentDto {
  @IsDateString() date: string;
  @IsNumber() @IsPositive() amount: number;
  @IsOptional() @IsString() method?: string;
  @IsOptional() @IsString() note?: string;
}
