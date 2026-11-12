import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCompanyDto {
  @IsString() @IsNotEmpty() @MaxLength(150) name: string;
  @IsOptional() @IsString() @MaxLength(200) legalName?: string;
  @IsOptional() @IsString() @MaxLength(40) taxNo?: string;
  @IsOptional() @IsString() @MaxLength(250) address?: string;
  @IsOptional() @IsString() @MaxLength(60) phone?: string;
  @IsOptional() @IsString() @MaxLength(120) email?: string;
  @IsOptional() @IsString() @MaxLength(150) poc?: string;
  /** true makes this the primary company (the others stop being primary) */
  @IsOptional() @IsBoolean() primary?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}
export class UpdateCompanyDto extends PartialType(CreateCompanyDto) {}
