import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Max, MaxLength, Min,
  ValidateNested,
} from 'class-validator';
import { PaymentMilestoneDto } from '../catalog/catalog.dto';

/**
 * A container quote. Costs are in the invoice currency. With a distributor, the buyer, country, port, Incoterm,
 * currency, rate (its price list) and payment terms default from it; anything sent here wins for this order only.
 */
export class CreateExportDto {
  @IsDateString() date: string;
  @IsOptional() @IsUUID() distributorId?: string | null;
  @IsOptional() @IsString() @IsNotEmpty() buyer?: string;
  @IsOptional() @IsString() @IsNotEmpty() country?: string;
  @IsOptional() @IsString() port?: string;
  @IsString() @IsNotEmpty() container: string;
  @IsOptional() @IsString() @IsNotEmpty() incoterm?: string;
  @IsUUID() productId: string;
  @IsInt() @Min(1) cartons: number;
  @IsOptional() @IsString() @IsNotEmpty() currency?: string;
  /** PKR per 1 unit of the invoice currency */
  @IsOptional() @IsNumber() @IsPositive() fxRate?: number;
  /** selling price per pack, in the invoice currency */
  @IsOptional() @IsNumber() @Min(0) rate?: number;
  @IsOptional() @IsInt() @Min(0) @Max(365) paymentDays?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => PaymentMilestoneDto) paymentPlan?: PaymentMilestoneDto[];
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

/** Finance lets an order ship over the credit limit or with invoices overdue */
export class CreditOverrideDto {
  @IsString() @IsNotEmpty() @MaxLength(500) reason: string;
}

/** part of a remittance applied to one invoice (an export shipment), in the remittance currency */
export class AllocationDto {
  @IsUUID() shipmentId: string;
  @IsNumber() @IsPositive() amount: number;
}

export class AllocateDto {
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => AllocationDto) allocations: AllocationDto[];
}

/** money an international distributor sent */
export class RemittanceDto {
  @IsDateString() date: string;
  @IsString() @MaxLength(3) currency: string;
  @IsNumber() @IsPositive() amount: number;
  @IsOptional() @IsNumber() @Min(0) fees?: number;
  /** PKR per 1 unit on the day the money arrived */
  @IsNumber() @IsPositive() fxRate: number;
  @IsString() @IsNotEmpty() @MaxLength(60) method: string;
  @IsOptional() @IsString() @MaxLength(80) bankRef?: string;
  /** which of the distributor's bank accounts it came from (its position in the list) */
  @IsOptional() @IsInt() @Min(0) bankIndex?: number;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => AllocationDto) allocations?: AllocationDto[];
}
