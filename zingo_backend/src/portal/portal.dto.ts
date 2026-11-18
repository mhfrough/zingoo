import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Max, MaxLength, Min,
  ValidateNested,
} from 'class-validator';
import { OrderTransportDto } from '../manufacturing/production-orders.dto';

/** a small attachment (image or PDF) sent as base64; the server checks the size and the type */
export class ProofDto {
  @IsOptional() @IsString() @MaxLength(250) proofName?: string;
  @IsOptional() @IsString() @MaxLength(60) proofMime?: string;
  @IsOptional() @IsString() @MaxLength(640_000) proofData?: string;
}

/** A distributor asks for stock. Staff can file one on the distributor's behalf with `distributorId`. */
/** one product of a distributor order: so many containers, packed by a template (figures may be changed for this order) */
export class RequestLineDto {
  @IsUUID() productId: string;
  @IsInt() @Min(1) @Max(100000) containers: number;
  @IsOptional() @IsString() @MaxLength(60) packaging?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(100000) packetsPerBundle?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100000) bundlesPerContainer?: number;
  /** Carton, Bora; empty = the template's */
  @IsOptional() @IsString() @MaxLength(40) containerUnit?: string | null;
  /** one of the product's manufacturers; empty = its default */
  @IsOptional() @IsUUID() manufacturerId?: string | null;
}

export class CreateRequestDto {
  @IsOptional() @IsUUID() distributorId?: string;
  @IsDateString() date: string;
  /** several products in one order (each becomes its own production order, grouped under one order number) */
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => RequestLineDto) lines?: RequestLineDto[];
  @IsOptional() @ValidateNested() @Type(() => OrderTransportDto) transport?: OrderTransportDto | null;
  /** older single-product form: one product, so many bundles (ignored when `lines` is given) */
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsInt() @Min(1) cartons?: number;
  @IsOptional() @IsDateString() requestedDate?: string;
  @IsOptional() @IsString() @MaxLength(60) poRef?: string;
  @IsOptional() @IsString() notes?: string;
}

/** Staff accept a request into a draft sales order; the price and terms are locked on that order. */
export class AcceptRequestDto {
  /** Production = order it from the manufacturer (default); Sales = a warehouse sales order (only with sales orders on) */
  @IsOptional() @IsIn(['Production', 'Sales']) into?: 'Production' | 'Sales';
  /** production: containers to order (empty = the bundles asked for, rounded up to whole containers) */
  @IsOptional() @IsInt() @Min(1) @Max(100000) containers?: number;
  @IsOptional() @IsString() @MaxLength(60) packaging?: string;
  @IsOptional() @IsDateString() dueDate?: string | null;
  /** production: false keeps the order as a draft instead of sending it to the manufacturer */
  @IsOptional() @IsBoolean() send?: boolean;
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
