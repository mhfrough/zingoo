import {
  IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Max, MaxLength, Min,
} from 'class-validator';

/** a small attachment (image or PDF) sent as base64; the server checks the size and the type */
export class ProofDto {
  @IsOptional() @IsString() @MaxLength(250) proofName?: string;
  @IsOptional() @IsString() @MaxLength(60) proofMime?: string;
  @IsOptional() @IsString() @MaxLength(640_000) proofData?: string;
}

/** A distributor asks for stock. Staff can file one on the distributor's behalf with `distributorId`. */
export class CreateRequestDto {
  @IsOptional() @IsUUID() distributorId?: string;
  @IsDateString() date: string;
  @IsUUID() productId: string;
  @IsInt() @Min(1) cartons: number;
  @IsOptional() @IsDateString() requestedDate?: string;
  @IsOptional() @IsString() @MaxLength(60) poRef?: string;
  @IsOptional() @IsString() notes?: string;
}

/** Staff accept a request into a draft sales order; the price and terms are locked on that order. */
export class AcceptRequestDto {
  @IsOptional() @IsNumber() @IsPositive() rate?: number;
  @IsOptional() @IsInt() @Min(0) terms?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) advancePct?: number;
  @IsOptional() @IsString() note?: string;
}

/** The reason staff give when they reject something. */
export class ReviewDto {
  @IsString() @IsNotEmpty() note: string;
}

/** Proof of delivery: good + damaged + missing cartons must equal what was shipped. */
export class CreateReceiptDto extends ProofDto {
  @IsOptional() @IsUUID() distributorId?: string;
  @IsUUID() orderId: string;
  @IsDateString() date: string;
  @IsInt() @Min(0) goodCartons: number;
  @IsInt() @Min(0) damagedCartons: number;
  @IsInt() @Min(0) missingCartons: number;
  @IsIn(['Good', 'Damaged', 'Wet', 'Tampered', 'Other']) condition: string;
  @IsOptional() @IsString() @MaxLength(80) waybill?: string;
  @IsOptional() @IsString() @MaxLength(120) receivedBy?: string;
  @IsOptional() @IsString() reason?: string;
}

/** "I paid": a payment advice that staff must verify before it becomes cash. */
export class CreateAdviceDto extends ProofDto {
  @IsOptional() @IsUUID() distributorId?: string;
  @IsUUID() orderId: string;
  @IsDateString() date: string;
  @IsNumber() @IsPositive() amount: number;
  @IsOptional() @IsString() method?: string;
  @IsOptional() @IsString() @MaxLength(80) bankRef?: string;
  @IsOptional() @IsString() note?: string;
}
