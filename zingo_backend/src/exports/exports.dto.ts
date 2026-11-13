import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Max, MaxLength, Min,
  ValidateNested,
} from 'class-validator';
import { PaymentMilestoneDto } from '../catalog/catalog.dto';

/**
 * A container quote. Costs are in the invoice currency. With a distributor, the buyer, country, port, Incoterm,
 * currency, rate (its price list) and payment terms default from it; anything sent here wins for this order only.
 */
export class CreateExportDto {
  @IsDateString() date: string;
  @IsOptional() @IsUUID() distributorId?: string | null;
  @IsOptional() @IsString() @IsNotEmpty() buyer?: string;
  @IsOptional() @IsString() @IsNotEmpty() country?: string;
  @IsOptional() @IsString() port?: string;
  @IsString() @IsNotEmpty() container: string;
  @IsOptional() @IsString() @IsNotEmpty() incoterm?: string;
  @IsUUID() productId: string;
  @IsInt() @Min(1) cartons: number;
  @IsOptional() @IsString() @IsNotEmpty() currency?: string;
  /** PKR per 1 unit of the invoice currency */
  @IsOptional() @IsNumber() @IsPositive() fxRate?: number;
  /** selling price per pack, in the invoice currency */
  @IsOptional() @IsNumber() @Min(0) rate?: number;
  @IsOptional() @IsInt() @Min(0) @Max(365) paymentDays?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => PaymentMilestoneDto) paymentPlan?: PaymentMilestoneDto[];
  @IsOptional() @IsNumber() @Min(0) inland?: number;
  @IsOptional() @IsNumber() @Min(0) origin?: number;
  @IsOptional() @IsNumber() @Min(0) documentation?: number;
  @IsOptional() @IsNumber() @Min(0) ocean?: number;
  @IsOptional() @IsNumber() @Min(0) insurance?: number;
  @IsOptional() @IsNumber() @Min(0) destination?: number;
  @IsOptional() @IsNumber() @Min(0) duty?: number;
  @IsOptional() @IsNumber() @Min(0) bankFees?: number;
  @IsOptional() @IsNumber() @Min(0) otherCosts?: number;
}
export class UpdateExportDto extends PartialType(CreateExportDto) {}

/** Ship a quote; the date defaults to today. */
export class ShipExportDto {
  @IsOptional() @IsDateString() shipDate?: string;
}

/** Foreign-currency money received from the buyer. */
export class ExportReceiptDto {
  @IsDateString() date: string;
  @IsNumber() @IsPositive() foreignAmount: number;
  /** PKR per 1 unit on the day the money arrived */
  @IsNumber() @IsPositive() fxRate: number;
  @IsOptional() @IsString() method?: string;
  @IsOptional() @IsString() note?: string;
}

/** PKR paid for the seller-side logistics costs. */
export class ExportCostPaymentDto {
  @IsDateString() date: string;
  @IsNumber() @IsPositive() amount: number;
  @IsOptional() @IsString() method?: string;
  @IsOptional() @IsString() note?: string;
}

/** Finance lets an order ship over the credit limit or with invoices overdue */
export class CreditOverrideDto {
  @IsString() @IsNotEmpty() @MaxLength(500) reason: string;
}

/** part of a remittance applied to one invoice (an export shipment), in the remittance currency */
export class AllocationDto {
  @IsUUID() shipmentId: string;
  @IsNumber() @IsPositive() amount: number;
}

export class AllocateDto {
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => AllocationDto) allocations: AllocationDto[];
}

/** money an international distributor sent */
export class RemittanceDto {
  @IsDateString() date: string;
  @IsString() @MaxLength(3) currency: string;
  @IsNumber() @IsPositive() amount: number;
  @IsOptional() @IsNumber() @Min(0) fees?: number;
  /** PKR per 1 unit on the day the money arrived */
  @IsNumber() @IsPositive() fxRate: number;
  @IsString() @IsNotEmpty() @MaxLength(60) method: string;
  @IsOptional() @IsString() @MaxLength(80) bankRef?: string;
  /** which of the distributor's bank accounts it came from (its position in the list) */
  @IsOptional() @IsInt() @Min(0) bankIndex?: number;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => AllocationDto) allocations?: AllocationDto[];
  /** the distributor's remittance advice this records */
  @IsOptional() @IsUUID() adviceId?: string;
}

class FileDto {
  @IsUUID() id: string;
  @IsString() @MaxLength(250) name: string;
  @IsString() @MaxLength(100) mime: string;
  @IsInt() @Min(0) size: number;
}

class ShipmentDocDto {
  @IsString() @IsNotEmpty() @MaxLength(80) type: string;
  @ValidateNested() @Type(() => FileDto) file: FileDto;
}

/** the actual logistics of a shipment; can be updated after it ships */
export class LogisticsDto {
  @IsOptional() @IsString() @MaxLength(120) dischargePort?: string | null;
  @IsOptional() @IsIn(['Sea', 'Air', 'Road', null]) shippingMode?: string | null;
  @IsOptional() @IsString() @MaxLength(60) bookingNo?: string | null;
  @IsOptional() @IsString() @MaxLength(30) containerNo?: string | null;
  @IsOptional() @IsString() @MaxLength(30) sealNo?: string | null;
  @IsOptional() @IsString() @MaxLength(60) blNo?: string | null;
  @IsOptional() @IsString() @MaxLength(80) vessel?: string | null;
  @IsOptional() @IsDateString() etd?: string | null;
  @IsOptional() @IsDateString() eta?: string | null;
  @IsOptional() @IsIn(['Loaded', 'Sailed', 'Arrived', 'Delivered', null]) shippingStatus?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ShipmentDocDto) documents?: ShipmentDocDto[];
  @IsOptional() @IsString() @MaxLength(60) batchRef?: string | null;
  @IsOptional() @IsDateString() mfgDate?: string | null;
  @IsOptional() @IsDateString() expiryDate?: string | null;
}

/** a damage, shortage, quality or return claim */
export class ClaimDto {
  @IsDateString() date: string;
  @IsIn(['Damage', 'Shortage', 'Quality', 'Return']) kind: string;
  @IsInt() @Min(1) quantity: number;
  @IsOptional() @IsString() @MaxLength(60) batchRef?: string;
  @IsString() @IsNotEmpty() @MaxLength(2000) description: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => FileDto) photos?: FileDto[];
}

export class ClaimDecisionDto {
  @IsIn(['Approve', 'Reject']) decision: 'Approve' | 'Reject';
  @IsOptional() @IsIn(['Credit note', 'Replacement']) resolution?: 'Credit note' | 'Replacement';
  /** in the invoice currency, for a credit note */
  @IsOptional() @IsNumber() @Min(0) creditAmount?: number;
  @IsOptional() @IsString() @MaxLength(2000) inspection?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

class CertificateDto {
  @IsString() @IsNotEmpty() @MaxLength(80) type: string;
  @ValidateNested() @Type(() => FileDto) file: FileDto;
  @IsOptional() @IsDateString() expiry?: string | null;
}

/** a product's eligibility for one market */
export class MarketApprovalDto {
  @IsUUID() productId: string;
  @IsString() @IsNotEmpty() @MaxLength(80) country: string;
  @IsOptional() @IsString() @MaxLength(40) labelVersion?: string | null;
  @IsOptional() @IsString() @MaxLength(120) labelLanguages?: string | null;
  @IsOptional() @ValidateNested() @Type(() => FileDto) labelFile?: FileDto | null;
  @IsOptional() @IsString() @MaxLength(2000) allergens?: string | null;
  @IsOptional() @IsString() @MaxLength(150) registrationAuthority?: string | null;
  @IsOptional() @IsString() @MaxLength(80) registrationNo?: string | null;
  @IsOptional() @IsDateString() registrationExpiry?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => CertificateDto) certificates?: CertificateDto[];
  @IsOptional() @IsInt() @Min(0) @Max(3650) minShelfLifeDays?: number;
  @IsOptional() @IsString() @MaxLength(2000) restrictions?: string | null;
}

export class ReviewDto {
  @IsIn(['Approve', 'Reject']) decision: 'Approve' | 'Reject';
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

/** the distributor's own "we paid", with proof */
export class RemittanceAdviceDto {
  @IsDateString() date: string;
  @IsString() @MaxLength(3) currency: string;
  @IsNumber() @IsPositive() amount: number;
  @IsOptional() @IsString() @MaxLength(60) method?: string;
  @IsOptional() @IsString() @MaxLength(80) bankRef?: string;
  @IsOptional() @IsString() @MaxLength(300) forInvoices?: string;
  @ValidateNested() @Type(() => FileDto) proof: FileDto;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class RejectAdviceDto {
  @IsString() @IsNotEmpty() @MaxLength(1000) note: string;
}
