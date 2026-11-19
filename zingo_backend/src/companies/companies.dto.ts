import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Length, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export class CreateCompanyDto {
  @IsString() @IsNotEmpty() @MaxLength(150) name: string;
  @IsOptional() @IsString() @MaxLength(200) legalName?: string;
  @IsOptional() @IsString() @MaxLength(40) taxNo?: string;
  @IsOptional() @IsString() @MaxLength(250) address?: string;
  @IsOptional() @IsString() @MaxLength(60) phone?: string;
  @IsOptional() @IsString() @MaxLength(120) email?: string;
  @IsOptional() @IsString() @MaxLength(150) poc?: string;
  @IsOptional() @IsInt() @Min(1) @Max(12) fiscalMonth?: number;
  @IsOptional() @IsIn(['Local', 'International']) market?: string;
  @IsOptional() @IsString() @MaxLength(60) region?: string;
  @IsOptional() @IsString() @MaxLength(80) country?: string;
  @IsOptional() @IsString() @MaxLength(80) state?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  /** optional money and approvals; null clears */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) approvalThreshold?: number | null;
  @IsOptional() @IsString() @MaxLength(120) signatoryA?: string;
  @IsOptional() @IsString() @MaxLength(120) signatoryB?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) capitalTarget?: number | null;
  /** true makes this the primary company (the others stop being primary) */
  @IsOptional() @IsBoolean() primary?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}
export class UpdateCompanyDto extends PartialType(CreateCompanyDto) {}
