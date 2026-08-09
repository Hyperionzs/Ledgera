import { IsEnum } from 'class-validator';
import { Role } from '@ledgera/shared';

export class UpdateRoleDto {
  @IsEnum(Role)
  role!: Role;
}
