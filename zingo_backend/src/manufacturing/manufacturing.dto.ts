import { PartialType } from '@nestjs/swagger';
import { IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Min } from 'class-validator';
import { PAY_METHODS, QC_STATUS } from '../common/enums';

export class CreateBatchDto {
  @IsDateString() date: string;
  @IsUUID() productId: string;
  @IsUUID() manufacturerId: string;
  @IsInt() @Min(1) targetCartons: number;
  @IsOptional() @IsInt() @Min(0) producedCartons?: number;
  /** total accrued cost of the batch, PKR */
  @IsOptional() @IsNumber() @Min(0) cost?: number;
  @IsOptional() @IsIn([...QC_STATUS]) qc?: (typeof QC_STATUS)[number];
  @IsOptional() @IsString() notes?: string;
}
export class UpdateBatchDto extends PartialType(CreateBatchDto) {}

export class CreateMfrPaymentDto {
  @IsUUID() batchId: string;
  @IsDateString() date: string;
  @IsNumber() @IsPositive() amount: number;
  @IsOptional() @IsIn([...PAY_METHODS]) method?: string;
  @IsOptional() @IsString() note?: string;
}
