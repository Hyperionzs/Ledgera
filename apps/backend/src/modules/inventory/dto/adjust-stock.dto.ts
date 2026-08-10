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

export class AdjustStockDto {
  @IsUUID()
  productId!: string;

  /** Absolute target stock after the adjustment (never negative). */
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  newStock!: number;

  /** Required — an adjustment without an explanation is an audit hole. */
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  referenceType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  referenceId?: string;
}
