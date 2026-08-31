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

  /** Receive stock on an existing transaction — used by the Purchase module
   *  so PO creation and stock-in commit/rollback together (one transaction). */
  stockInTx(
    tx: Prisma.TransactionClient,
    params: {
      productId: string;
      quantity: number;
      reason?: string;
      referenceType?: string;
      referenceId?: string;
    },
  ) {
    return this.mutateTx(tx, params.productId, 'STOCK_IN', params.quantity, params.reason, {
      referenceType: params.referenceType,
      referenceId: params.referenceId,
    });
  }

  /** Receive stock. Movement row first, then atomic increment. */
  async stockIn(dto: StockInDto) {
    return this.prisma.$transaction((tx) =>
      this.mutateTx(tx, dto.productId, 'STOCK_IN', dto.quantity, dto.reason, dto),
    );
  }

  /** Issue stock. Negative stock is blocked (INSUFFICIENT_STOCK). */
  async stockOut(dto: StockOutDto) {
    return this.prisma.$transaction((tx) =>
      this.mutateTx(tx, dto.productId, 'STOCK_OUT', dto.quantity, dto.reason, dto),
    );
  }

  /** Set stock to an absolute value. reason is mandatory. */
  async adjust(dto: AdjustStockDto) {
    return this.prisma.$transaction((tx) =>
      this.mutateTx(tx, dto.productId, 'ADJUSTMENT', dto.newStock, dto.reason, dto),
    );
  }

  // ---------------------------------------------------------------------------
  // Core mutation — one transaction, atomic stock change, full audit trail
  // ---------------------------------------------------------------------------

  private async mutateTx(
    tx: Prisma.TransactionClient,
    productId: string,
    type: MovementType,
    quantity: number,
    reason: string | undefined,
    dto: { referenceType?: string; referenceId?: string },
  ) {
    const product = await tx.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true, stock: true },
    });
    if (!product) throw new NotFoundException('PRODUCT_NOT_FOUND');

    const beforeStock = product.stock;
    let afterStock: number;
    let movementQty = quantity;

    if (type === 'STOCK_OUT') {
      // Atomic conditional decrease — the DB decides whether enough stock
      // exists, so two concurrent stock-outs cannot both pass (only one row
      // matches stock >= quantity). This replaces check-then-act, which had
      // a race window that could drive stock negative.
      const res = await tx.product.updateMany({
        where: { id: productId, stock: { gte: quantity } },
        data: { stock: { decrement: quantity } },
      });
      if (res.count === 0) throw new BadRequestException('INSUFFICIENT_STOCK');
      const after = await tx.product.findUnique({
        where: { id: productId },
        select: { stock: true },
      });
      // row exists (the updateMany above matched it), so stock is defined
      afterStock = after?.stock ?? 0;
    } else if (type === 'STOCK_IN') {
      // increment is monotonic — no guard needed, read back actual value.
      const updated = await tx.product.update({
        where: { id: productId },
        data: { stock: { increment: quantity } },
        select: { stock: true },
      });
      afterStock = updated.stock;
    } else {
      // ADJUSTMENT — absolute set to target (quantity param = newStock).
      // Can never go negative (DTO @Min(0)); delta is |after - before|.
      afterStock = quantity;
      movementQty = Math.abs(afterStock - beforeStock);
      await tx.product.update({
        where: { id: productId },
        data: { stock: afterStock },
      });
    }

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

    return {
      productId,
      type,
      beforeStock,
      afterStock,
      stock: afterStock,
      reason: reason ?? null,
    };
  }
}
