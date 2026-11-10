import { IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { INCOTERMS } from '../common/enums';

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
