import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';
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
  /** uploaded photos / PDFs (POST /attachments), several allowed */
  @IsOptional() @IsArray() @ArrayMaxSize(8) @IsUUID(undefined, { each: true }) proofIds?: string[];
}

/** one damage line typed on the pickup or the receipt form: it becomes a claim on that load */
export class ClaimLineDto {
  @IsIn(DELIVERY_CLAIM_KINDS) kind: (typeof DELIVERY_CLAIM_KINDS)[number];
  @IsInt() @Min(1) @Max(1_000_000) bundles: number;
  @IsString() @IsNotEmpty() @MaxLength(500) note: string;
  @IsOptional() @IsArray() @ArrayMaxSize(8) @IsUUID(undefined, { each: true }) proofIds?: string[];
}

/** a message on a claim */
export class ClaimNoteDto {
  @IsString() @IsNotEmpty() @MaxLength(1000) text: string;
}

/** The manufacturer (or Admin / Manufacturing for it) decides. A rejection needs a reason. */
export class DecideDeliveryClaimDto {
  /** Hold parks it (with a reason) until the manufacturer's manager accepts or rejects it */
  @IsIn(['Accept', 'Reject', 'Hold']) decision: 'Accept' | 'Reject' | 'Hold';
  @ValidateIf((o) => o.decision === 'Accept') @IsIn(DELIVERY_CLAIM_RESOLUTIONS) resolution?: (typeof DELIVERY_CLAIM_RESOLUTIONS)[number];
  @ValidateIf((o) => o.decision !== 'Accept') @IsString() @IsNotEmpty() @MaxLength(500) note?: string;
}
