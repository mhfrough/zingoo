import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ACCOUNT_TYPES, INCOTERMS } from '../common/enums';

export class UpdateSettingsDto {
  @IsOptional() @IsString() @IsNotEmpty() companyName?: string;
  @IsOptional() @IsInt() @Min(1) fiscalMonth?: number;
  @IsOptional() @IsString() numberFormat?: string;
  @IsOptional() @IsNumber() @Min(0) capitalTarget?: number;
  @IsOptional() @IsInt() @Min(1) packsPerCarton?: number;
  @IsOptional() @IsNumber() @Min(0) approvalThreshold?: number;
  @IsOptional() @IsString() signatoryA?: string;
  @IsOptional() @IsString() signatoryB?: string;
  @IsOptional() @IsInt() @Min(0) lowStockCartons?: number;
  @IsOptional() @IsString() containerSize?: string;
  @IsOptional() @IsIn([...INCOTERMS]) defaultIncoterm?: string;
  @IsOptional() @IsNumber() @Min(0) salesTaxRate?: number;
  @IsOptional() @IsNumber() @Min(0) profitAllocationPerPack?: number;
  @IsOptional() @IsInt({ each: true }) paymentCycles?: number[];
  @IsOptional() @IsInt() @Min(1) defaultPaymentCycle?: number;
}

export class CreateCostCenterDto {
  @IsString() @IsNotEmpty() name: string;
  @IsNumber() @Min(0) budget: number;
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
