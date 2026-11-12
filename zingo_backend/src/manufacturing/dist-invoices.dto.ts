import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';

/** containers of one received delivery */
export class InvoiceLineDto {
  @IsUUID() shipmentId: string;
  @IsInt() @Min(1) @Max(100000) containers: number;
}

/** The distributor reports containers it distributed (staff may enter it for a distributor). */
export class CreateDistInvoiceDto {
  @IsDateString() date: string;
  /** staff only; a distributor login always invoices for itself */
  @IsOptional() @IsUUID() distributorId?: string;
  @IsOptional() @IsString() @MaxLength(60) invoiceNo?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => InvoiceLineDto) lines: InvoiceLineDto[];
}

/** money received from the distributor against a verified invoice */
export class DistInvoicePayDto {
  @IsDateString() date: string;
  @IsNumber() @Min(0.01) amount: number;
  @IsString() @MaxLength(40) method: string;
  @IsOptional() @IsString() @MaxLength(80) toAccount?: string;
  @IsOptional() @IsString() @MaxLength(80) reference?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
