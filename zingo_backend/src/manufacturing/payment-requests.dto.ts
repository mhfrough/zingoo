import { PlainRef } from '../common/plain-text';
import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { REQUEST_KINDS, RequestKind } from './payment-requests.entities';

/** A manufacturer asks to be paid against one of its accepted orders. */
export class CreatePaymentRequestDto {
  @IsUUID() orderId: string;
  @IsIn([...REQUEST_KINDS]) kind: RequestKind;
  /** empty = everything still open for this kind (the rest of the advance, or the rest of the order value) */
  @IsOptional() @IsNumber() @Min(0.01) amount?: number;
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsString() @MaxLength(60) invoiceNo?: string;
  /** the invoice number Zen Foods files it under; empty = the next one (PR-009) */
  @IsOptional() @IsString() @MaxLength(30) refNo?: string;
  /** account number of one of the manufacturer's bank accounts; empty = its default */
  @IsOptional() @IsString() @MaxLength(40) bankAccount?: string;
  /** several accounts to print on the invoice (the first is where it asks to be paid); overrides bankAccount */
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) bankAccounts?: string[];
  /** empty = the date for an advance, the date plus the manufacturer's credit days for a balance */
  @IsOptional() @IsDateString() dueDate?: string;
  /** an uploaded order document (the manufacturer's own invoice copy) */
  @IsOptional() @IsUUID() invoiceFileId?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/** The company pays an approved request (fully or partly). */
export class PayRequestDto {
  @IsDateString() date: string;
  @IsNumber() @Min(0.01) amount: number;
  @IsString() @MaxLength(40) method: string;
  /** the company account paid from (Settings list BANK_ACCOUNT) */
  @IsOptional() @IsString() @MaxLength(80) fromAccount?: string;
  @IsOptional() @PlainRef() @IsString() @MaxLength(80) reference?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
