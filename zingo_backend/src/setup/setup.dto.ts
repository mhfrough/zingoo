import { IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsObject, IsOptional, IsPositive, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { ACCOUNT_TYPES } from '../common/enums';
import { LOOKUP_LISTS, LookupList } from './lookups.service';

export class UpdateSettingsDto {
  @IsOptional() @IsString() @IsNotEmpty() companyName?: string;
  @IsOptional() @IsInt() @Min(1) fiscalMonth?: number;
  @IsOptional() @IsString() numberFormat?: string;
  @IsOptional() @IsNumber() @Min(0) capitalTarget?: number;
  @IsOptional() @IsInt() @Min(1) packsPerCarton?: number;
  @IsOptional() @IsInt() @Min(1) bundlesPerContainer?: number;
  @IsOptional() @IsInt() @Min(1) @Max(365) defaultSelloutDays?: number;
  @IsOptional() @IsNumber() @Min(0) approvalThreshold?: number;
  @IsOptional() @IsString() signatoryA?: string;
  @IsOptional() @IsString() signatoryB?: string;
  @IsOptional() @IsInt() @Min(0) lowStockCartons?: number;
  @IsOptional() @IsString() containerSize?: string;
  @IsOptional() @IsString() defaultIncoterm?: string;
  @IsOptional() @IsNumber() @Min(0) salesTaxRate?: number;
  @IsOptional() @IsNumber() @Min(0) profitAllocationPerPack?: number;
  @IsOptional() @IsInt({ each: true }) paymentCycles?: number[];
  @IsOptional() @IsInt() @Min(1) defaultPaymentCycle?: number;
  /** reference prefixes, e.g. { sales: 'SO', batch: 'B', finance: 'FIN', accounting: 'ACC', export: 'EXP' } */
  @IsOptional() @IsObject() docPrefixes?: Record<string, string>;
  /** upper day limits of the aged-receivable buckets, e.g. [30, 60, 90] */
  @IsOptional() @IsArray() @IsInt({ each: true }) @Min(1, { each: true }) agingBuckets?: number[];
}

export class CreateCostCenterDto {
  @IsString() @IsNotEmpty() name: string;
  @IsNumber() @Min(0) budget: number;
  /** a type from the stream types list in Settings */
  @IsOptional() @IsString() @MaxLength(40) streamType?: string;
  /** percent per year; only kept for a depreciable type */
  @IsOptional() @IsNumber() @Min(0) @Max(100) depreciationRate?: number;
}

/** Set the type of an investment stream (and the depreciation rate for a depreciable type). */
export class SetStreamDto {
  @IsString() @MaxLength(40) streamType: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) depreciationRate?: number;
}

export class SetBudgetDto {
  @IsNumber() @Min(0) budget: number;
}

/** Add an account to the chart of accounts. */
export class CreateAccountDto {
  @IsString() @IsNotEmpty() @MaxLength(10) code: string;
  @IsString() @IsNotEmpty() @MaxLength(80) name: string;
  @IsIn([...ACCOUNT_TYPES]) type: (typeof ACCOUNT_TYPES)[number];
}

/** Rename an account or switch it off; postings already made stay. */
export class UpdateAccountDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

/** Add an entry to an editable pick-list. */
export class CreateLookupDto {
  @IsIn([...LOOKUP_LISTS]) list: LookupList;
  @IsString() @IsNotEmpty() @MaxLength(40) code: string;
  @IsOptional() @IsString() @MaxLength(250) description?: string;
  @IsOptional() @IsObject() flags?: Record<string, boolean>;
  @IsOptional() @IsObject() meta?: Record<string, string>;
}

/** The code never changes; the text, the seller's cost lines and the on/off switch can. */
export class UpdateLookupDto {
  @IsOptional() @IsString() @MaxLength(250) description?: string;
  @IsOptional() @IsObject() flags?: Record<string, boolean>;
  @IsOptional() @IsObject() meta?: Record<string, string>;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class CreateCurrencyDto {
  @IsString() @Length(3, 3) code: string;
  @IsString() @IsNotEmpty() @MaxLength(60) name: string;
  @IsString() @IsNotEmpty() @MaxLength(8) symbol: string;
  /** PKR per 1 unit */
  @IsNumber() @IsPositive() rate: number;
}

export class UpdateCurrencyDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) name?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(8) symbol?: string;
  @IsOptional() @IsNumber() @IsPositive() rate?: number;
}

export class CreateContainerDto {
  @IsString() @IsNotEmpty() @MaxLength(10) code: string;
  @IsInt() @Min(1) maxCartons: number;
}

export class UpdateContainerDto {
  @IsInt() @Min(1) maxCartons: number;
}

/** Income and expense categories (cost centers have their own endpoint because of the budget). */
export class CreateCategoryDto {
  @IsIn(['INCOME', 'EXPENSE']) kind: 'INCOME' | 'EXPENSE';
  @IsString() @IsNotEmpty() @MaxLength(80) name: string;
}

export class RenameCategoryDto {
  @IsString() @IsNotEmpty() @MaxLength(80) name: string;
}
