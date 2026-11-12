import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';

/** an uploaded file on a partner (from POST /attachments) */
export class PartnerFileDto {
  @IsUUID() id: string;
  @IsString() @MaxLength(250) name: string;
  @IsString() @MaxLength(100) mime: string;
  @IsInt() @Min(0) size: number;
}

/** one bank account of a manufacturer */
export class PartnerBankAccountDto {
  @IsString() @IsNotEmpty() @MaxLength(80) bank: string;
  @IsString() @IsNotEmpty() @MaxLength(150) title: string;
  /** account number or IBAN */
  @IsString() @IsNotEmpty() @MaxLength(40) account: string;
  @IsOptional() @IsString() @MaxLength(150) branch?: string;
  @IsBoolean() isDefault: boolean;
}

export class CreateProductDto {
  @IsString() @IsNotEmpty() sku: string;
  @IsString() @IsNotEmpty() name: string;
  @IsInt() @Min(1) pack: number;
  @IsNumber() @Min(0) mrp: number;
  @IsNumber() @Min(0) rate: number;
  /** packets per bundle */
  @IsInt() @Min(1) @Max(100000) packsPerCarton: number;
  @IsOptional() @IsInt() @Min(1) @Max(100000) bundlesPerContainer?: number;
  @IsOptional() @IsString() @MaxLength(80) flavour?: string | null;
  @IsOptional() @IsString() @MaxLength(40) packetSize?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
  @IsOptional() @IsUUID() manufacturerId?: string | null;
  @IsOptional() @IsUUID() distributorId?: string | null;
  /** empty = the distributor's default */
  @IsOptional() @IsInt() @Min(1) @Max(365) selloutDays?: number | null;
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
  @IsOptional() @IsInt() @Min(0) @Max(365) paymentDays?: number;
  /** advance on each order, % of its value */
  @IsOptional() @IsNumber() @Min(0) @Max(100) advancePct?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => PartnerBankAccountDto) bankAccounts?: PartnerBankAccountDto[];
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() contact?: string;
  @IsOptional() @IsString() @MaxLength(150) poc?: string;
  @IsOptional() @IsString() @MaxLength(150) contract?: string;
  @IsOptional() @IsString() @MaxLength(5000) terms?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => PartnerFileDto) files?: PartnerFileDto[];
}
export class UpdateManufacturerDto extends PartialType(CreateManufacturerDto) {}

export class CreateDistributorDto {
  @IsString() @IsNotEmpty() name: string;
  /** main city */
  @IsString() @IsNotEmpty() @MaxLength(80) region: string;
  @IsOptional() @IsString() @MaxLength(60) province?: string | null;
  /** other cities or areas covered */
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @MaxLength(80, { each: true }) areas?: string[];
  @IsOptional() @IsString() contact?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() taxNo?: string;
  @IsOptional() @IsIn([15, 30, 45, 60, 90]) paymentDays?: number;
  @IsOptional() @IsNumber() @Min(0) creditLimit?: number;
  @IsOptional() @IsNumber() @Min(0) advancePct?: number;
  @IsOptional() @IsInt() @Min(1) @Max(365) selloutDays?: number;
  @IsOptional() @IsString() @MaxLength(150) poc?: string;
  @IsOptional() @IsString() @MaxLength(150) contract?: string;
  @IsOptional() @IsString() @MaxLength(5000) terms?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => PartnerFileDto) files?: PartnerFileDto[];
}
export class UpdateDistributorDto extends PartialType(CreateDistributorDto) {}
