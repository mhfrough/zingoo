import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Min, MinLength } from 'class-validator';
import { PAY_METHODS } from '../common/enums';

export class CreateOrderDto {
  @IsDateString() date: string;
  @IsUUID() distributorId: string;
  @IsUUID() productId: string;
  @IsInt() @Min(1) cartons: number;
  /** price per pack, PKR */
  @IsNumber() @Min(0) rate: number;
  @IsOptional() @IsString() poRef?: string;
  @IsOptional() @IsString() notes?: string;
}
export class UpdateOrderDto extends PartialType(CreateOrderDto) {}

export class CreditOverrideDto {
  /** why finance allows this order although the credit limit is exceeded */
  @IsString() @MinLength(3) reason: string;
}

export class CreateCollectionDto {
  @IsUUID() orderId: string;
  @IsDateString() date: string;
  @IsNumber() @IsPositive() amount: number;
  @IsOptional() @IsIn([...PAY_METHODS]) method?: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsBoolean() isAdvance?: boolean;
}
