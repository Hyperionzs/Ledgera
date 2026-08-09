import { IsEmail, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { Role } from '@ledgera/shared';

export class UpdateUserDto {
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  isActive?: boolean;
}
