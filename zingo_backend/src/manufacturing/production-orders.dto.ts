import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { ORDER_DESTINATIONS, OrderDestination } from './production-orders.entities';

/** planned transport: who carries the goods and the driver (all optional) */
export class OrderTransportDto {
  @IsOptional() @IsString() @MaxLength(80) transporter?: string | null;
  @IsOptional() @IsString() @MaxLength(30) vehicleNo?: string | null;
  @IsOptional() @IsString() @MaxLength(80) driverName?: string | null;
  @IsOptional() @IsString() @MaxLength(30) driverPhone?: string | null;
  @IsOptional() @IsString() @MaxLength(20) driverCnic?: string | null;
}

/** A new production order. Manufacturer, distributor and rate default to what the product is set up with. */
export class CreateProductionOrderDto {
  @IsDateString() date: string;
  @IsUUID() productId: string;
  @IsOptional() @IsUUID() manufacturerId?: string;
  @IsOptional() @IsIn([...ORDER_DESTINATIONS]) destination?: OrderDestination;
  @IsOptional() @IsUUID() distributorId?: string | null;
  @IsInt() @Min(1) @Max(100000) containers: number;
  /** a packaging template of the product, by name; empty = its default */
  @IsOptional() @IsString() @MaxLength(60) packaging?: string | null;
  /** packing for this order only (the template stays as it is); empty = the template's figures */
  @IsOptional() @IsInt() @Min(1) @Max(100000) packetsPerBundle?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100000) bundlesPerContainer?: number;
  @IsOptional() @ValidateNested() @Type(() => OrderTransportDto) transport?: OrderTransportDto | null;
  /** Carton, Bora for this order; empty = the template's */
  @IsOptional() @IsString() @MaxLength(40) containerUnit?: string | null;
  /** price per packet; empty = the product's manufacturer rate */
  @IsOptional() @IsNumber() @Min(0) rate?: number;
  @IsOptional() @IsDateString() dueDate?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
  /** true = send it to the manufacturer straight away */
  @IsOptional() @IsBoolean() send?: boolean;
}

/** Change a draft order (only drafts can change). */
export class UpdateProductionOrderDto extends PartialType(CreateProductionOrderDto) {}

/** The manufacturer accepts: optionally with the date it expects the containers ready. */
export class AcceptProductionOrderDto {
  @IsOptional() @IsDateString() readyDate?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/** A rejection or a cancellation needs a reason. */
export class ReasonDto {
  @IsString() @IsNotEmpty() @MaxLength(500) reason: string;
}

/** The manufacturer reports the step it has reached. */
export class StageDto {
  @IsString() @IsNotEmpty() @MaxLength(80) stage: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
