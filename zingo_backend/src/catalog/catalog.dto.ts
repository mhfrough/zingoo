import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { DISTRIBUTOR_MARKETS, DISTRIBUTOR_STATUS, DistributorMarket, DistributorStatus, MANUFACTURER_TERMS, ManufacturerTerm } from './catalog.entities';

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

/** one saved way of packing a product */
export class PackagingTemplateDto {
  @IsString() @IsNotEmpty() @MaxLength(60) name: string;
  @IsInt() @Min(1) @Max(100000) packetsPerBundle: number;
  @IsInt() @Min(1) @Max(100000) bundlesPerContainer: number;
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
  /** every distributor that sells it; the first becomes the main one */
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID(undefined, { each: true }) distributorIds?: string[];
  @IsOptional() @IsNumber() @Min(0) gramsPerPacket?: number | null;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => PackagingTemplateDto) packagings?: PackagingTemplateDto[];
  @IsOptional() @IsNumber() @Min(0) outboundRate?: number;
  /** empty = the distributor's default; 0 = no limit */
  @IsOptional() @IsInt() @Min(0) @Max(365) selloutDays?: number | null;
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
  /** Advance and / or Credit line; at least one */
  @IsOptional() @IsArray() @ArrayMinSize(1) @IsIn([...MANUFACTURER_TERMS], { each: true }) paymentTerms?: ManufacturerTerm[];
  /** credit line: days to clear, 0 = no limit */
  @IsOptional() @IsInt() @Min(0) @Max(365) paymentDays?: number;
  /** credit line: limit in the manufacturer's currency, 0 = no limit */
  @IsOptional() @IsNumber() @Min(0) creditLimit?: number;
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

export class AreaDistrictDto {
  @IsString() @IsNotEmpty() @MaxLength(80) name: string;
  @IsString() @IsNotEmpty() @MaxLength(60) province: string;
}

export class AreaCityDto {
  @IsString() @IsNotEmpty() @MaxLength(80) name: string;
  @IsString() @IsNotEmpty() @MaxLength(60) province: string;
  @IsOptional() @IsString() @MaxLength(80) district?: string | null;
}

export class CreateDistributorDto {
  @IsString() @IsNotEmpty() name: string;
  @IsOptional() @IsIn([...DISTRIBUTOR_MARKETS]) market?: DistributorMarket;
  /** territory label for lists; worked out from the areas when left out */
  @IsOptional() @IsString() @MaxLength(80) region?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(60, { each: true }) provinces?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => AreaDistrictDto) districts?: AreaDistrictDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(600) @ValidateNested({ each: true }) @Type(() => AreaCityDto) cities?: AreaCityDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(250) @IsString({ each: true }) @MaxLength(80, { each: true }) countries?: string[];
  @IsOptional() @IsBoolean() exclusive?: boolean;
  @IsOptional() @IsIn([...DISTRIBUTOR_STATUS]) status?: DistributorStatus;
  @IsOptional() @IsString() @MaxLength(500) statusNote?: string | null;
  @IsOptional() @IsDateString() statusUntil?: string | null;
  @IsOptional() @IsString() contact?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() taxNo?: string;
  /** days to pay; any number (a custom term), 0 = no limit */
  @IsOptional() @IsInt() @Min(0) @Max(365) paymentDays?: number;
  @IsOptional() @IsNumber() @Min(0) creditLimit?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) advancePct?: number;
  /** 0 = no limit */
  @IsOptional() @IsInt() @Min(0) @Max(365) selloutDays?: number;
  @IsOptional() @IsString() @MaxLength(150) poc?: string;
  @IsOptional() @IsString() @MaxLength(150) contract?: string;
  @IsOptional() @IsString() @MaxLength(5000) terms?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => PartnerFileDto) files?: PartnerFileDto[];
}
export class UpdateDistributorDto extends PartialType(CreateDistributorDto) {}
