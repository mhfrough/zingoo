import { ClaimLineDto } from './delivery-claims.dto';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';

/** The manufacturer sends containers of an accepted order. */
export class ShipDto {
  @IsUUID() orderId: string;
  @IsDateString() date: string;
  @IsInt() @Min(1) @Max(100000) containers: number;
  @IsOptional() @IsString() @MaxLength(60) vehicle?: string;
  @IsOptional() @IsString() @MaxLength(60) waybill?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
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
