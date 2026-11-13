import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PORTAL_ROLES, PortalRole, ROLES, Role, SEATS, Seat, USER_STATUS } from '../common/enums';

/** A new login. A Distributor or Manufacturer login must also say which company it belongs to. */
export class CreateUserDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @IsEmail() email: string;
  @IsString() @MinLength(8) @MaxLength(100) password: string;
  @IsIn([...ROLES]) role: Role;
  @IsOptional() @IsIn([...SEATS]) seat?: Seat;
  @IsOptional() @IsUUID() distributorId?: string;
  @IsOptional() @IsUUID() manufacturerId?: string;
  /** a distributor login's role in the portal */
  @IsOptional() @IsIn([...PORTAL_ROLES]) portalRole?: PortalRole;
}

export class UpdateUserDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
  @IsOptional() @IsIn([...ROLES]) role?: Role;
  @IsOptional() @IsIn([...SEATS]) seat?: Seat;
  @IsOptional() @IsIn([...USER_STATUS]) status?: 'Active' | 'Disabled';
  @IsOptional() @IsUUID() distributorId?: string | null;
  @IsOptional() @IsUUID() manufacturerId?: string | null;
  @IsOptional() @IsIn([...PORTAL_ROLES]) portalRole?: PortalRole;
}

export class ResetPasswordDto {
  @IsString() @MinLength(8) @MaxLength(100) password: string;
}
