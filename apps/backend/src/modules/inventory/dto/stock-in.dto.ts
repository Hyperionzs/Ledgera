import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class StockInDto {
  @IsUUID()
  productId!: string;

  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  quantity!: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  reason?: string;

  /** Reference to the source document (e.g. PURCHASE order id) — nullable for MVP. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  referenceType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  referenceId?: string;
}
