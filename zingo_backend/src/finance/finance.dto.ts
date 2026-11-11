import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID,
  Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { DOC_KINDS, FINANCE_TYPES } from '../common/enums';

export class CreateFinanceDto {
  @IsDateString() date: string;
  @IsIn([...FINANCE_TYPES]) type: (typeof FINANCE_TYPES)[number];
  /** cost center / investment stream */
  @IsString() @IsNotEmpty() category: string;
  @IsNumber() @IsPositive() amount: number;
  @IsOptional() @IsString() party?: string;
  @IsOptional() @IsString() @MaxLength(40) funding?: string;
  @IsOptional() @IsString() note?: string;
}
export class UpdateFinanceDto extends PartialType(CreateFinanceDto) {}

/** One stream an investor's money goes against. Give the amount or the percent of the investor's amount. */
export class StreamShareDto {
  @IsString() @IsNotEmpty() @MaxLength(80) stream: string;
  @IsOptional() @IsNumber() @IsPositive() amount?: number;
  @IsOptional() @IsNumber() @IsPositive() @Max(100) pct?: number;
}

/** One investor in a capital injection. */
export class CapitalLineDto {
  @IsString() @IsNotEmpty() @MaxLength(150) party: string;
  @IsNumber() @IsPositive() amount: number;
  @IsDateString() date: string;
  /** a capital source from Settings */
  @IsOptional() @IsString() @MaxLength(40) funding?: string;
  /** a payment method from Settings; a cheque needs chequeNo and clearanceDate */
  @IsOptional() @IsString() @MaxLength(30) paymentSource?: string;
  @IsOptional() @IsString() @MaxLength(100) paymentReference?: string;
  @IsOptional() @IsString() @MaxLength(150) paymentAgainst?: string;
  @IsOptional() @IsString() @MaxLength(100) paidBy?: string;
  @IsOptional() @IsString() @MaxLength(100) receivedBy?: string;
  @IsOptional() @IsDateString() issueDate?: string;
  @IsOptional() @IsDateString() expectedReturnDate?: string;
  @IsOptional() @IsString() @MaxLength(40) chequeNo?: string;
  @IsOptional() @IsDateString() clearanceDate?: string;
  @IsOptional() @IsUUID() proofId?: string;
  @IsOptional() @IsUUID() agreementId?: string;
  /** invested against: at least one stream; the parts must add up to the amount */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => StreamShareDto)
  streams: StreamShareDto[];
}

/** A capital injection: one investor, or several investing together. */
export class CreateCapitalDto {
  /** terms of the investment, copied onto every investor line */
  @IsOptional() @IsString() note?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => CapitalLineDto)
  investors: CapitalLineDto[];
}

/** Mark a cheque cleared (the money is in the bank) or bounced. */
export class ChequeDto {
  @IsIn(['Cleared', 'Bounced']) status: 'Cleared' | 'Bounced';
  /** the day it cleared; defaults to the expected clearance date, never in the future */
  @IsOptional() @IsDateString() date?: string;
}

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
  @IsOptional() @IsString() method?: string;
  @IsOptional() @IsString() note?: string;
}

export class UuidDto {
  @IsUUID() id: string;
}
