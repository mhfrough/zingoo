import { IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { DELIVERY_CLAIM_KINDS, DELIVERY_CLAIM_RESOLUTIONS } from './delivery-claims.entities';

/** The distributor (or staff for it) reports faulty bundles in a received delivery. */
export class CreateDeliveryClaimDto {
  @IsUUID() shipmentId: string;
  @IsDateString() date: string;
  @IsIn(DELIVERY_CLAIM_KINDS) kind: (typeof DELIVERY_CLAIM_KINDS)[number];
  @IsInt() @Min(1) @Max(1_000_000) bundles: number;
  @IsString() @IsNotEmpty() @MaxLength(500) note: string;
  @IsOptional() @IsString() @MaxLength(250) proofName?: string;
  @IsOptional() @IsString() @MaxLength(60) proofMime?: string;
  @IsOptional() @IsString() @MaxLength(640_000) proofData?: string;
}

/** The manufacturer (or Admin / Manufacturing for it) decides. A rejection needs a reason. */
export class DecideDeliveryClaimDto {
  @IsIn(['Accept', 'Reject']) decision: 'Accept' | 'Reject';
  @ValidateIf((o) => o.decision === 'Accept') @IsIn(DELIVERY_CLAIM_RESOLUTIONS) resolution?: (typeof DELIVERY_CLAIM_RESOLUTIONS)[number];
  @ValidateIf((o) => o.decision === 'Reject') @IsString() @IsNotEmpty() @MaxLength(500) note?: string;
}
