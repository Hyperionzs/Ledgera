import { IsUUID, IsInt, Min, Max } from 'class-validator';

export class SaleItemDto {
  @IsUUID()
  productId!: string;

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity!: number;
}
