import { ClaimLineDto } from './delivery-claims.dto';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';

/** The manufacturer sends containers of an accepted order. */
export class ShipDto {
  @IsUUID() orderId: string;
  @IsDateString() date: string;
  @IsInt() @Min(1) @Max(100000) containers: number;
  @IsOptional() @IsString() @MaxLength(60) vehicle?: string;
  @IsOptional() @IsString() @MaxLength(60) waybill?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/** one product of the dispatch: containers made ready and loaded, and containers damaged in production */
export class DispatchLineDto {
  @IsUUID() orderId: string;
  @IsInt() @Min(0) @Max(100000) ready: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000) damaged?: number | null;
}

/**
 * Ready to Dispatch: the last production step. The distributor's vehicle is at the factory; the manufacturer loads
 * it and records what each product made ready, the vehicle, the driver and the signed proof of handover.
 */
export class DispatchDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => DispatchLineDto) lines: DispatchLineDto[];
  @IsDateString() date: string;
  @IsString() @IsNotEmpty() @MaxLength(30) vehicleNo: string;
  @IsString() @IsNotEmpty() @MaxLength(80) driverName: string;
  @IsString() @IsNotEmpty() @MaxLength(30) driverPhone: string;
  @IsOptional() @IsString() @MaxLength(80) transporter?: string;
  /** transporter's bilty / waybill number */
  @IsOptional() @IsString() @MaxLength(60) biltyNo?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  /** the signed gate pass / delivery challan or the driver's signature: order documents of kind HANDOVER */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsUUID(undefined, { each: true }) proofIds: string[];
}

/** one product of a received dispatch: bundles found damaged on arrival (empty = none) */
export class ReceiveDispatchLineDto {
  @IsUUID() shipmentId: string;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) damaged?: number | null;
}

/** The distributor receives a whole dispatch; damage on arrival opens a dispute with the manufacturer. */
export class ReceiveDispatchDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ReceiveDispatchLineDto) lines: ReceiveDispatchLineDto[];
  @IsDateString() date: string;
  /** what was damaged (required when anything was) */
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  /** photos / PDFs of the damaged goods (POST /attachments) */
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID(undefined, { each: true }) proofIds?: string[];
}

/** The distributor (or the warehouse) confirms what arrived. Fewer than sent needs a note. */
export class ReceiveDto {
  @IsDateString() date: string;
  @IsInt() @Min(0) @Max(100000) receivedContainers: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  /** damaged / missing / poor bundles found on arrival: each becomes a claim on this load */
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => ClaimLineDto) damages?: ClaimLineDto[];
}

/** The distributor (or staff for it) collects containers of a ready order from the factory. */
export class PickupDto {
  @IsUUID() orderId: string;
  @IsDateString() date: string;
  @IsInt() @Min(1) @Max(100000) containers: number;
  /** truck number */
  @IsOptional() @IsString() @MaxLength(60) vehicle?: string;
  /** driver or person who collected */
  @IsOptional() @IsString() @MaxLength(60) collectedBy?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  /** damage found at the factory gate: each line becomes a claim on this pickup */
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => ClaimLineDto) damages?: ClaimLineDto[];
}
