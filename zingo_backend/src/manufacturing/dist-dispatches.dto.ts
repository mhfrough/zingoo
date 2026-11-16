import { IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';

/** The distributor (or staff for it) sends bundles of a received delivery to one of its customers. */
export class CreateDistDispatchDto {
  @IsUUID() shipmentId: string;
  @IsDateString() date: string;
  @IsInt() @Min(1) @Max(1_000_000) bundles: number;
  @IsString() @IsNotEmpty() @MaxLength(120) customer: string;
  @IsOptional() @IsString() @MaxLength(120) area?: string;
  @IsOptional() @IsString() @MaxLength(60) vehicle?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/** The dispatch reached the customer, or came back (a return needs a reason). */
export class CloseDistDispatchDto {
  @IsIn(['Delivered', 'Returned']) outcome: 'Delivered' | 'Returned';
  @IsDateString() date: string;
  @ValidateIf((o) => o.outcome === 'Returned') @IsString() @IsNotEmpty() @MaxLength(500) note?: string;
  @ValidateIf((o) => o.outcome === 'Delivered') @IsOptional() @IsString() @MaxLength(500) deliveredNote?: string;
}
