import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MovementType, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StockInDto } from './dto/stock-in.dto';
import { StockOutDto } from './dto/stock-out.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { QueryInventoryDto } from './dto/query-inventory.dto';

/**
 * Inventory Management — current stock on Product, full audit trail in
 * StockMovement. Every mutation runs in a single transaction: the product is
 * re-read, a movement row is inserted with before/after snapshots, then the
 * product's stock is updated atomically (increment/decrement). All-or-nothing.
 */
@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  /** List all products with current stock + category + supplier for dashboards. */
  async findAll(query: QueryInventoryDto) {
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(query.search && {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { sku: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        select: {
          id: true,
          sku: true,
          name: true,
          stock: true,
          minimumStock: true,
          isActive: true,
          category: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
        },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      items,
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  /** Detail: product stock summary + full movement history (newest first). */
  async findOne(productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: {
        id: true,
        sku: true,
        name: true,
        stock: true,
        minimumStock: true,
        isActive: true,
        category: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
      },
    });
    if (!product) throw new NotFoundException('PRODUCT_NOT_FOUND');

    const movements = await this.prisma.stockMovement.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        type: true,
        quantity: true,
        beforeStock: true,
        afterStock: true,
        reason: true,
        referenceType: true,
        referenceId: true,
        createdAt: true,
      },
    });

    return { ...product, movements };
  }

  /** Receive stock. Movement row first, then atomic increment. */
  async stockIn(dto: StockInDto) {
    return this.mutate(dto.productId, 'STOCK_IN', dto.quantity, dto.reason, dto);
  }

  /** Issue stock. Negative stock is blocked (INSUFFICIENT_STOCK). */
  async stockOut(dto: StockOutDto) {
    return this.mutate(dto.productId, 'STOCK_OUT', dto.quantity, dto.reason, dto);
  }

  /** Set stock to an absolute value. reason is mandatory. */
  async adjust(dto: AdjustStockDto) {
    return this.mutate(dto.productId, 'ADJUSTMENT', dto.newStock, dto.reason, dto);
  }

  // ---------------------------------------------------------------------------
  // Core mutation — one transaction, atomic stock change, full audit trail
  // ---------------------------------------------------------------------------

  private async mutate(
    productId: string,
    type: MovementType,
    quantity: number,
    reason: string | undefined,
    dto: { referenceType?: string; referenceId?: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: productId, deletedAt: null },
        select: { id: true, stock: true },
      });
      if (!product) throw new NotFoundException('PRODUCT_NOT_FOUND');

      const beforeStock = product.stock;
      const afterStock =
        type === 'STOCK_IN'
          ? beforeStock + quantity
          : type === 'STOCK_OUT'
            ? beforeStock - quantity
            : quantity; // ADJUSTMENT: absolute target

      if (afterStock < 0) {
        throw new BadRequestException('INSUFFICIENT_STOCK');
      }

      // quantity is always positive: for ADJUSTMENT it's |after - before|.
      const movementQty = type === 'ADJUSTMENT' ? Math.abs(afterStock - beforeStock) : quantity;

      await tx.stockMovement.create({
        data: {
          productId,
          type,
          quantity: movementQty,
          beforeStock,
          afterStock,
          reason: reason ?? null,
          referenceType: dto.referenceType ?? null,
          referenceId: dto.referenceId ?? null,
        },
      });

      const updated = await tx.product.update({
        where: { id: productId },
        data: {
          stock:
            type === 'STOCK_IN'
              ? { increment: quantity }
              : type === 'STOCK_OUT'
                ? { decrement: quantity }
                : afterStock, // ADJUSTMENT is an absolute set
        },
        select: { id: true, stock: true },
      });

      return {
        productId,
        type,
        beforeStock,
        afterStock,
        stock: updated.stock,
        reason: reason ?? null,
      };
    });
  }
}
