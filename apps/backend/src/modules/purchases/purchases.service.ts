import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { QueryPurchaseDto } from './dto/query-purchase.dto';

/**
 * Purchase Management — receives goods from a supplier. This is the first
 * orchestrator module: PO creation + item lines + stock-in movements commit
 * in ONE transaction via InventoryService.stockInTx (never a nested txn, and
 * never an HTTP call to the inventory endpoint).
 */
@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  async create(dto: CreatePurchaseDto) {
    return this.prisma.$transaction(async (tx) => {
      // Resolve supplier: must exist, be active, and not soft-deleted.
      let supplierName = '';
      if (dto.supplierId) {
        const supplier = await tx.supplier.findFirst({
          where: { id: dto.supplierId, isActive: true, deletedAt: null },
          select: { name: true },
        });
        if (!supplier) throw new NotFoundException('SUPPLIER_NOT_FOUND');
        supplierName = supplier.name;
      } else {
        supplierName = 'Walk-in';
      }

      // Resolve products: each must exist, be active, not soft-deleted.
      const seen = new Set<string>();
      const productNames = new Map<string, string>();
      for (const item of dto.items) {
        if (seen.has(item.productId)) {
          throw new BadRequestException('PURCHASE_ITEMS_DUPLICATE');
        }
        seen.add(item.productId);
        const product = await tx.product.findFirst({
          where: { id: item.productId, isActive: true, deletedAt: null },
          select: { name: true },
        });
        if (!product) throw new NotFoundException('PRODUCT_NOT_FOUND');
        productNames.set(item.productId, product.name);
      }

      // Total = Σ(quantity × unitPrice). Decimals avoid float drift.
      const totalAmount = dto.items.reduce(
        (sum, i) => sum.add(i.unitPrice * i.quantity),
        new Prisma.Decimal(0),
      );

      const purchase = await tx.purchase.create({
        data: {
          referenceNo: this.generateReferenceNo(),
          supplierId: dto.supplierId ?? null,
          supplierName,
          notes: dto.notes ?? null,
          totalAmount,
          items: {
            create: dto.items.map((i) => ({
              productId: i.productId,
              productName: productNames.get(i.productId) ?? '',
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              totalAmount: new Prisma.Decimal(i.unitPrice * i.quantity),
            })),
          },
        },
      });

      // Stock-in for every item, inside the SAME transaction.
      for (const i of dto.items) {
        await this.inventory.stockInTx(tx, {
          productId: i.productId,
          quantity: i.quantity,
          referenceType: 'PURCHASE',
          referenceId: purchase.id,
        });
      }

      // Fetch full purchase details within the same transaction to avoid read lag
      const createdPurchase = await tx.purchase.findUnique({
        where: { id: purchase.id },
        include: {
          items: {
            select: { productId: true, quantity: true, unitPrice: true, totalAmount: true },
          },
        },
      });

      if (!createdPurchase) throw new NotFoundException('PURCHASE_NOT_FOUND');
      return createdPurchase;
    });
  }

  async findAll(query: QueryPurchaseDto) {
    const where: Prisma.PurchaseWhereInput = {
      ...(query.search && {
        OR: [
          { referenceNo: { contains: query.search, mode: 'insensitive' } },
          { supplierName: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.purchase.findMany({
        where,
        select: this.purchaseSelect,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.purchase.count({ where }),
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

  async findOne(id: string) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      include: {
        items: { select: { productId: true, quantity: true, unitPrice: true, totalAmount: true } },
      },
    });
    if (!purchase) throw new NotFoundException('PURCHASE_NOT_FOUND');
    return purchase;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private generateReferenceNo(): string {
    // Not unique-guaranteed by design (MVP): it is a human-facing label only.
    return `PO-${new Date()
      .toISOString()
      .replace(/[-:TZ.]/g, '')
      .slice(0, 14)}`;
  }

  private readonly purchaseSelect = {
    id: true,
    referenceNo: true,
    supplierId: true,
    supplierName: true,
    status: true,
    notes: true,
    totalAmount: true,
    createdAt: true,
  } satisfies Prisma.PurchaseSelect;
}
