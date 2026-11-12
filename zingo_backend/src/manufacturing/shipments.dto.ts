import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

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
}
