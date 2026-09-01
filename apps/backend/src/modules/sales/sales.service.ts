import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { QuerySaleDto } from './dto/query-sale.dto';

/**
 * Sales Management — complete atomic flow for recording sales transactions.
 *
 * create() runs in a single $transaction:
 * 1. Validate items: not empty, no duplicate productIds
 * 2. For each item: fetch product (must be active, not deleted), snapshot name,
 *    fetch sellingPrice from DB (never from client)
 * 3. Calculate totalAmount server-side with Prisma.Decimal
 * 4. Create Sale + SaleItem records
 * 5. For each item: call inventory.stockOutTx() to decrement stock
 * 6. If INSUFFICIENT_STOCK on any item → entire transaction rolls back
 * 7. Query sale within transaction before return
 *
 * All-or-nothing: if any step fails, entire sale creation fails.
 */
@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  /**
   * Create a new completed sale transaction atomically.
   *
   * Entire flow happens in one $transaction so that if any step fails
   * (product not found, insufficient stock), the entire sale and its
   * stock movements roll back.
   */
  async create(dto: CreateSaleDto) {
    return this.prisma.$transaction(async (tx) => {
      // Step 1: Validate items structure
      if (!dto.items || dto.items.length === 0) {
        throw new BadRequestException('Items must not be empty');
      }

      const productIds = dto.items.map((item) => item.productId);
      const uniqueProductIds = new Set(productIds);
      if (uniqueProductIds.size !== productIds.length) {
        throw new BadRequestException('Duplicate productId in items');
      }

      // Step 2: Validate products exist, capture names & prices
      const productNames = new Map<string, string>();
      const sellingPrices = new Map<string, Prisma.Decimal>();

      for (const item of dto.items) {
        const product = await tx.product.findFirst({
          where: {
            id: item.productId,
            isActive: true,
            deletedAt: null,
          },
          select: {
            id: true,
            name: true,
            sellingPrice: true,
          },
        });

        if (!product) {
          throw new NotFoundException('PRODUCT_NOT_FOUND');
        }

        productNames.set(product.id, product.name);
        sellingPrices.set(product.id, product.sellingPrice);
      }

      // Step 3: Calculate totalAmount server-side using Prisma.Decimal
      let totalAmount = new Prisma.Decimal(0);
      for (const item of dto.items) {
        const sellingPrice = sellingPrices.get(item.productId)!;
        const itemTotal = sellingPrice.mul(new Prisma.Decimal(item.quantity));
        totalAmount = totalAmount.add(itemTotal);
      }

      // Step 4: Create Sale header
      const sale = await tx.sale.create({
        data: {
          referenceNo: this.generateReferenceNo(),
          customerId: dto.customerId || null,
          customerName: dto.customerName || 'Walk-in',
          notes: dto.notes || null,
          totalAmount,
          // Nested create: SaleItem records
          items: {
            create: dto.items.map((item) => {
              const sellingPrice = sellingPrices.get(item.productId)!;
              const itemTotal = sellingPrice.mul(new Prisma.Decimal(item.quantity));
              return {
                productId: item.productId,
                productName: productNames.get(item.productId)!,
                quantity: item.quantity,
                unitPrice: sellingPrice,
                totalAmount: itemTotal,
              };
            }),
          },
        },
      });

      // Step 5: For each item, decrement stock via stockOutTx (same transaction)
      // If any stockOut fails (INSUFFICIENT_STOCK), exception bubbles & entire
      // $transaction rolls back (sale + items + stock movements).
      for (const item of dto.items) {
        await this.inventory.stockOutTx(tx, {
          productId: item.productId,
          quantity: item.quantity,
          referenceType: 'SALE',
          referenceId: sale.id,
        });
      }

      // Step 6: Query sale within transaction before return
      const createdSale = await tx.sale.findUnique({
        where: { id: sale.id },
        include: {
          items: {
            select: {
              id: true,
              productId: true,
              productName: true,
              quantity: true,
              unitPrice: true,
              totalAmount: true,
            },
          },
        },
      });

      return createdSale;
    });
  }

  /**
   * List all sales with pagination and search.
   *
   * Search matches referenceNo or customerName (case-insensitive).
   * Results sorted by createdAt descending (newest first).
   */
  async findAll(query: QuerySaleDto) {
    const where: Prisma.SaleWhereInput = {
      ...(query.search && {
        OR: [
          { referenceNo: { contains: query.search, mode: 'insensitive' } },
          { customerName: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.sale.findMany({
        where,
        select: {
          id: true,
          referenceNo: true,
          customerId: true,
          customerName: true,
          totalAmount: true,
          createdAt: true,
        },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.sale.count({ where }),
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

  /**
   * Fetch a single sale by id with all its items.
   */
  async findOne(id: string) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: {
        items: {
          select: {
            id: true,
            productId: true,
            productName: true,
            quantity: true,
            unitPrice: true,
            totalAmount: true,
          },
        },
      },
    });

    if (!sale) {
      throw new NotFoundException('SALE_NOT_FOUND');
    }

    return sale;
  }

  /**
   * Generate a reference number for the sale.
   *
   * Format: SL-<timestamp>
   * Not guaranteed globally unique by design (multiple sales may be created
   * at the same millisecond), but sufficient for human-readable identification
   * combined with the database id.
   */
  private generateReferenceNo(): string {
    const timestamp = Date.now();
    return `SL-${timestamp}`;
  }
}
