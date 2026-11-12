import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID,
  IsObject, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { DOC_KINDS, FINANCE_TYPES } from '../common/enums';
import { INVESTOR_TYPES, InvestorType } from './finance.entities';

export class CreateFinanceDto {
  @IsDateString() date: string;
  @IsIn([...FINANCE_TYPES]) type: (typeof FINANCE_TYPES)[number];
  /** cost center / investment stream */
  @IsString() @IsNotEmpty() category: string;
  @IsNumber() @IsPositive() amount: number;
  @IsOptional() @IsString() party?: string;
  @IsOptional() @IsString() @MaxLength(40) funding?: string;
  @IsOptional() @IsString() note?: string;
  /** spend only: the capital entry (loan, advance or equity) this spend is paid from; it must have room left on this stream */
  @IsOptional() @IsUUID() fundedById?: string;
}
export class UpdateFinanceDto extends PartialType(CreateFinanceDto) {}

/** One stream an investor's money goes against. Give the amount or the percent of the investor's amount. */
export class StreamShareDto {
  @IsString() @IsNotEmpty() @MaxLength(80) stream: string;
  @IsOptional() @IsNumber() @IsPositive() amount?: number;
  @IsOptional() @IsNumber() @IsPositive() @Max(100) pct?: number;
}

/** One investor in a capital injection: an account (a manufacturer, a distributor or a person) and their money. */
export class CapitalLineDto {
  @IsIn([...INVESTOR_TYPES]) partyType: InvestorType;
  /** id of the manufacturer, the distributor or the entry of the People list */
  @IsUUID() partyId: string;
  @IsNumber() @IsPositive() amount: number;
  @IsDateString() date: string;
  /** a payment method from Settings; a cheque needs chequeNo and clearanceDate */
  @IsOptional() @IsString() @MaxLength(30) paymentSource?: string;
  @IsOptional() @IsString() @MaxLength(100) paymentReference?: string;
  /** the bank or cash account (Settings) this investor's money came into; wins over the injection's bankAccount */
  @IsOptional() @IsString() @MaxLength(60) bankAccount?: string;
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
  /** the type of funding for the whole injection: a capital source from Settings (Equity, Shareholder Loan, Partner Advance ...) */
  @IsOptional() @IsString() @MaxLength(40) funding?: string;
  /** terms of the investment, copied onto every investor line */
  @IsOptional() @IsString() note?: string;

  // loan and advance terms (ignored for equity); the options come from Settings
  /** advance only: 'out' = the company pays the partner an advance */
  @IsOptional() @IsIn(['in', 'out']) direction?: 'in' | 'out';
  @IsOptional() @IsString() @MaxLength(50) tenure?: string;
  @IsOptional() @IsString() @MaxLength(50) repaymentPlan?: string;
  @IsOptional() @IsString() @MaxLength(50) repaymentFrequency?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) markupPct?: number;
  @IsOptional() @IsString() @MaxLength(60) purpose?: string;
  @IsOptional() @IsString() @MaxLength(60) settlementMethod?: string;
  @IsOptional() @IsString() @MaxLength(100) linkedReference?: string;
  /** which of the company's bank or cash accounts took the money (Settings) */
  @IsOptional() @IsString() @MaxLength(60) bankAccount?: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => CapitalLineDto)
  investors: CapitalLineDto[];
}

/** Mark a cheque cleared (the money is in the bank) or bounced. */
export class ChequeDto {
  @IsIn(['Cleared', 'Bounced']) status: 'Cleared' | 'Bounced';
  /** the day it cleared; defaults to the expected clearance date, never in the future */
  @IsOptional() @IsDateString() date?: string;
}

/** A repayment of a loan or advance, or the markup paid on it. */
export class RepaymentDto {
  @IsDateString() date: string;
  @IsNumber() @IsPositive() amount: number;
  @IsIn(['principal', 'markup']) kind: 'principal' | 'markup';
  /** a payment method from Settings */
  @IsOptional() @IsString() @MaxLength(30) method?: string;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsUUID() proofId?: string;
}

export class SignDto {
  @IsIn(['A', 'B']) seat: 'A' | 'B';
}

/** One SKU line of an income invoice. */
export class InvoiceLineDto {
  @IsUUID() productId: string;
  @IsNumber() @IsPositive() @Max(10_000_000) qty: number;
  @IsIn(['Packs', 'Dozens', 'Cartons']) uom: 'Packs' | 'Dozens' | 'Cartons';
  /** per pack, invoice currency */
  @IsNumber() @Min(0) sellPrice: number;
  /** per pack, PKR */
  @IsOptional() @IsNumber() @Min(0) unitCost?: number;
}

export class CreateAccountingDto {
  @IsDateString() date: string;
  @IsIn([...DOC_KINDS]) kind: (typeof DOC_KINDS)[number];
  @IsString() @IsNotEmpty() category: string;
  /** amount in the invoice currency; worked out from the lines when an income invoice has them */
  @IsOptional() @IsNumber() @Min(0) foreignAmount?: number;
  /** Draft is saved but not posted; Issued (the default) posts */
  @IsOptional() @IsIn(['Draft', 'Issued']) status?: 'Draft' | 'Issued';
  @IsOptional() @IsString() @MaxLength(60) invoiceNo?: string;
  @IsOptional() @IsString() @MaxLength(60) customerTaxId?: string;
  @IsOptional() @IsString() @MaxLength(80) region?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(365) paymentDays?: number;
  @IsOptional() @IsString() @MaxLength(60) receivingAccount?: string;
  @IsOptional() @IsString() @MaxLength(80) orderRef?: string;
  @IsOptional() @IsString() @MaxLength(60) deliveryStatus?: string;
  @IsOptional() @IsString() @MaxLength(120) deliveryProof?: string;
  @IsOptional() @IsString() @MaxLength(120) salesOwner?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => InvoiceLineDto) lines?: InvoiceLineDto[];
  @IsOptional() @IsNumber() @Min(0) discount?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) salesTaxPct?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) whtPct?: number;
  @IsOptional() @IsObject() sellerCosts?: Record<string, number>;
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
