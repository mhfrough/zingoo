import { IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { REQUEST_KINDS, RequestKind } from './payment-requests.entities';

/** A manufacturer asks to be paid against one of its accepted orders. */
export class CreatePaymentRequestDto {
  @IsUUID() orderId: string;
  @IsIn([...REQUEST_KINDS]) kind: RequestKind;
  /** empty = everything still open for this kind (the rest of the advance, or the rest of the order value) */
  @IsOptional() @IsNumber() @Min(0.01) amount?: number;
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsString() @MaxLength(60) invoiceNo?: string;
  /** account number of one of the manufacturer's bank accounts; empty = its default */
  @IsOptional() @IsString() @MaxLength(40) bankAccount?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/** The company pays an approved request (fully or partly). */
export class PayRequestDto {
  @IsDateString() date: string;
  @IsNumber() @Min(0.01) amount: number;
  @IsString() @MaxLength(40) method: string;
  /** the company account paid from (Settings list BANK_ACCOUNT) */
  @IsOptional() @IsString() @MaxLength(80) fromAccount?: string;
  @IsOptional() @IsString() @MaxLength(80) reference?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
