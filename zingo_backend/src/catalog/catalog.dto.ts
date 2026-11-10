import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateProductDto {
  @IsString() @IsNotEmpty() sku: string;
  @IsString() @IsNotEmpty() name: string;
  @IsInt() @Min(1) pack: number;
  @IsNumber() @Min(0) mrp: number;
  @IsNumber() @Min(0) rate: number;
  @IsInt() @Min(1) packsPerCarton: number;
  @IsOptional() @IsNumber() @Min(0) manufacturerRate?: number;
  @IsOptional() @IsNumber() @Min(0) packagingRate?: number;
  @IsOptional() @IsNumber() @Min(0) printingRate?: number;
  @IsOptional() @IsNumber() @Min(0) inboundRate?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
export class UpdateProductDto extends PartialType(CreateProductDto) {}

export class CreateManufacturerDto {
  @IsString() @IsNotEmpty() name: string;
  @IsOptional() @IsInt() @Min(0) paymentDays?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() contact?: string;
}
export class UpdateManufacturerDto extends PartialType(CreateManufacturerDto) {}

export class CreateDistributorDto {
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsNotEmpty() region: string;
  @IsOptional() @IsString() contact?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() taxNo?: string;
  @IsOptional() @IsIn([15, 30, 45, 60, 90]) paymentDays?: number;
  @IsOptional() @IsNumber() @Min(0) creditLimit?: number;
  @IsOptional() @IsNumber() @Min(0) advancePct?: number;
}
export class UpdateDistributorDto extends PartialType(CreateDistributorDto) {}
