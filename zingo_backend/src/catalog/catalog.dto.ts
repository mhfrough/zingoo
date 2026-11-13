import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import {
  BANK_CHARGES, BankCharges, PAYMENT_TERM_TYPES, PAYMENT_TRIGGERS, PRICE_UNITS, PaymentTermType, PaymentTrigger, PriceUnit,
} from './catalog.entities';
import { ADDRESS_TYPES, AGREEMENT_STATUS, AddressType, AgreementStatus, DISTRIBUTOR_MARKETS, DISTRIBUTOR_STATUS, DistributorMarket, DistributorStatus, MANUFACTURER_TERMS, ManufacturerTerm } from './catalog.entities';

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

/** one person at the distributor */
export class DistributorContactDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(80) role?: string;
  @IsOptional() @IsEmail() @MaxLength(150) email?: string;
  @IsOptional() @IsString() @MaxLength(8) phoneCode?: string;
  @IsOptional() @IsString() @MaxLength(30) mobile?: string;
  @IsOptional() @IsString() @MaxLength(30) whatsapp?: string;
  @IsBoolean() isPrimary: boolean;
}

/** one address of the distributor */
export class DistributorAddressDto {
  @IsIn([...ADDRESS_TYPES]) type: AddressType;
  @IsString() @IsNotEmpty() @MaxLength(300) line: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(80) region?: string;
  @IsOptional() @IsString() @MaxLength(20) postalCode?: string;
  @IsString() @IsNotEmpty() @MaxLength(80) country: string;
  @IsBoolean() isDefault: boolean;
}

/** one KYC document */
export class KycDocumentDto {
  @IsString() @IsNotEmpty() @MaxLength(80) type: string;
  @ValidateNested() @Type(() => PartnerFileDto) file: PartnerFileDto;
  @IsOptional() @IsDateString() expiry?: string | null;
}

/** one instalment of a payment plan */
export class PaymentMilestoneDto {
  @IsString() @IsNotEmpty() @MaxLength(80) label: string;
  @IsNumber() @Min(0.01) @Max(100) pct: number;
  @IsIn([...PAYMENT_TRIGGERS]) trigger: PaymentTrigger;
  @IsInt() @Min(0) @Max(365) days: number;
}

/** a bank account the distributor pays from (verification is a separate step) */
export class DistributorBankDto {
  @IsString() @IsNotEmpty() @MaxLength(150) beneficiary: string;
  @IsString() @IsNotEmpty() @MaxLength(120) bankName: string;
  @IsString() @IsNotEmpty() @MaxLength(40) account: string;
  @IsOptional() @IsString() @MaxLength(40) iban?: string | null;
  @IsOptional() @IsString() @MaxLength(11) swift?: string | null;
  @IsOptional() @IsString() @MaxLength(3) currency?: string | null;
  @IsBoolean() isDefault: boolean;
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
  // international distributor (spec sections 1 and 2)
  @IsOptional() @IsString() @MaxLength(200) legalName?: string | null;
  @IsOptional() @IsString() @MaxLength(200) website?: string | null;
  @IsOptional() @IsString() @MaxLength(80) classification?: string | null;
  @IsOptional() @IsString() @MaxLength(80) country?: string | null;
  @IsOptional() @IsString() @MaxLength(80) registrationNo?: string | null;
  @IsOptional() @IsString() @MaxLength(150) registrationAuthority?: string | null;
  @IsOptional() @IsDateString() registrationExpiry?: string | null;
  @IsOptional() @IsString() @MaxLength(150) taxTreatment?: string | null;
  @IsOptional() @IsString() @MaxLength(80) licenceNo?: string | null;
  @IsOptional() @IsString() @MaxLength(150) licenceAuthority?: string | null;
  @IsOptional() @IsDateString() licenceIssued?: string | null;
  @IsOptional() @IsDateString() licenceExpiry?: string | null;
  @IsOptional() @IsString() @MaxLength(120) accountManager?: string | null;
  @IsOptional() @IsString() @MaxLength(120) salesTeam?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => DistributorContactDto) contacts?: DistributorContactDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => DistributorAddressDto) addresses?: DistributorAddressDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => KycDocumentDto) kycDocs?: KycDocumentDto[];
  @IsOptional() @IsDateString() agreementStart?: string | null;
  @IsOptional() @IsDateString() agreementEnd?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(3650) renewalNoticeDays?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(3650) noticePeriodDays?: number | null;
  @IsOptional() @IsString() @MaxLength(40) agreementVersion?: string | null;
  @IsOptional() @IsIn([...AGREEMENT_STATUS]) agreementStatus?: AgreementStatus;
  @IsOptional() @ValidateNested() @Type(() => PartnerFileDto) agreementFile?: PartnerFileDto | null;
  @IsOptional() @IsString() @MaxLength(300) moq?: string | null;
  @IsOptional() @IsNumber() @Min(0) quarterlyTarget?: number;
  @IsOptional() @IsNumber() @Min(0) annualTarget?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID(undefined, { each: true }) approvedProductIds?: string[];
  @IsOptional() @IsString() @MaxLength(120) salesChannel?: string | null;
  // pricing, currency and payment terms (spec sections 3 and 4); an international credit limit is set through /credit
  @IsOptional() @IsString() @MaxLength(3) invoiceCurrency?: string | null;
  @IsOptional() @IsString() @MaxLength(10) incoterm?: string | null;
  @IsOptional() @IsString() @MaxLength(120) incotermPlace?: string | null;
  @IsOptional() @IsString() @MaxLength(20) incotermVersion?: string;
  @IsOptional() @IsIn([...PAYMENT_TERM_TYPES]) paymentTermType?: PaymentTermType | null;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => PaymentMilestoneDto) paymentPlan?: PaymentMilestoneDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(60, { each: true }) settlementMethods?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => DistributorBankDto) bankAccounts?: DistributorBankDto[];
  @IsOptional() @IsIn([...BANK_CHARGES]) bankCharges?: BankCharges | null;
  @IsOptional() @IsNumber() @Min(0) @Max(100) minMarginPct?: number;
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

/** Finance approves an international distributor's credit: limit (0 = advance only), currency, expiry, control */
export class DistributorCreditDto {
  @IsNumber() @Min(0) creditLimit: number;
  @IsString() @MaxLength(3) creditCurrency: string;
  @IsOptional() @IsDateString() creditExpiry?: string | null;
  @IsIn(['Block', 'Warn']) creditControl: 'Block' | 'Warn';
}

/** a new price version for one SKU */
export class CreateDistributorPriceDto {
  @IsUUID() productId: string;
  @IsString() @MaxLength(3) currency: string;
  @IsIn([...PRICE_UNITS]) unit: PriceUnit;
  /** needed for Pallet and Metric tonne; worked out for the others */
  @IsOptional() @IsNumber() @Min(0.0001) packsPerUnit?: number;
  @IsNumber() @Min(0.0001) price: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) discountPct?: number;
  @IsDateString() effectiveFrom: string;
  @IsOptional() @IsDateString() effectiveTo?: string | null;
  @IsOptional() @IsNumber() @Min(0) moq?: number;
  @IsOptional() @IsNumber() @Min(0) increment?: number;
  @IsOptional() @IsBoolean() promo?: boolean;
  @IsOptional() @IsString() @MaxLength(300) note?: string | null;
}

export class PriceDecisionDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
