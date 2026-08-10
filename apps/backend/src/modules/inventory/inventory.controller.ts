import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Role } from '@ledgera/shared';
import { InventoryService } from './inventory.service';
import { StockInDto } from './dto/stock-in.dto';
import { StockOutDto } from './dto/stock-out.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { QueryInventoryDto } from './dto/query-inventory.dto';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  /** List: CASHIER can read stock levels. */
  @Get()
  findAll(@Query() query: QueryInventoryDto) {
    return this.inventoryService.findAll(query);
  }

  /** Detail: product + movement history. CASHIER can read. */
  @Get(':productId')
  findOne(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.inventoryService.findOne(productId);
  }

  /** Write operations: ADMIN/OWNER only. Purchase/Sales call the service directly. */
  @Post('stock-in')
  @Roles(Role.ADMIN, Role.OWNER)
  stockIn(@Body() dto: StockInDto) {
    return this.inventoryService.stockIn(dto);
  }

  @Post('stock-out')
  @Roles(Role.ADMIN, Role.OWNER)
  stockOut(@Body() dto: StockOutDto) {
    return this.inventoryService.stockOut(dto);
  }

  @Post('adjust')
  @Roles(Role.ADMIN, Role.OWNER)
  adjust(@Body() dto: AdjustStockDto) {
    return this.inventoryService.adjust(dto);
  }
}
