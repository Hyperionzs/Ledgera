import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/** Profile update only — role and status have dedicated endpoints. */
export class UpdateUserDto {
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;
}
