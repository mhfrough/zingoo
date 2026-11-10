import { PartialType } from '@nestjs/swagger';
import {
  IsDateString, IsIn, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Min,
} from 'class-validator';
import { DOC_KINDS, FINANCE_TYPES, FUNDING, PAY_METHODS } from '../common/enums';

export class CreateFinanceDto {
  @IsDateString() date: string;
  @IsIn([...FINANCE_TYPES]) type: (typeof FINANCE_TYPES)[number];
  /** cost center / investment stream */
  @IsString() @IsNotEmpty() category: string;
  @IsNumber() @IsPositive() amount: number;
  @IsOptional() @IsString() party?: string;
  @IsOptional() @IsIn([...FUNDING]) funding?: (typeof FUNDING)[number];
  @IsOptional() @IsString() note?: string;
}
export class UpdateFinanceDto extends PartialType(CreateFinanceDto) {}

export class SignDto {
  @IsIn(['A', 'B']) seat: 'A' | 'B';
}

export class CreateAccountingDto {
  @IsDateString() date: string;
  @IsIn([...DOC_KINDS]) kind: (typeof DOC_KINDS)[number];
  @IsString() @IsNotEmpty() category: string;
  /** amount in the invoice currency */
  @IsNumber() @IsPositive() foreignAmount: number;
  @IsOptional() @IsString() currency?: string;
  /** PKR per 1 unit of the currency; must be 1 for PKR */
  @IsOptional() @IsNumber() @Min(0.000001) fxRate?: number;
  @IsString() @IsNotEmpty() party: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsString() note?: string;
}
export class UpdateAccountingDto extends PartialType(CreateAccountingDto) {}

export class SettleDto {
  @IsDateString() date: string;
  @IsNumber() @IsPositive() amount: number;
  @IsOptional() @IsIn([...PAY_METHODS]) method?: string;
  @IsOptional() @IsString() note?: string;
}

export class UuidDto {
  @IsUUID() id: string;
}
