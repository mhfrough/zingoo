import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

/** One debit or credit line of a manual journal voucher, in the voucher's currency. */
export class VoucherLineDto {
  /** ledger account NAME, e.g. "Cash & Bank" */
  @IsString() @IsNotEmpty() account: string;
  @IsNumber() @Min(0) debit: number;
  @IsNumber() @Min(0) credit: number;
}

/** A multi-line manual journal voucher. Debits and credits must match. */
export class CreateVoucherDto {
  @IsDateString() date: string;
  @IsString() @IsNotEmpty() memo: string;
  @IsOptional() @IsString() currency?: string;
  /** PKR per 1 unit of the voucher currency (1 for PKR) */
  @IsOptional() @IsNumber() @Min(0.000001) fxRate?: number;
  @IsArray() @ArrayMinSize(2) @ValidateNested({ each: true }) @Type(() => VoucherLineDto)
  lines: VoucherLineDto[];
}
