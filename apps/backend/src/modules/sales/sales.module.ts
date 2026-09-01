import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  controllers: [SalesController],
  providers: [SalesService],
  imports: [InventoryModule], // reuse stockOutTx
  exports: [SalesService],
})
export class SalesModule {}
