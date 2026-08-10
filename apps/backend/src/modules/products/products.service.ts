import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { UpdateStatusDto } from './dto/update-status.dto';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateProductDto) {
    this.assertValidPrice(dto.purchasePrice, dto.sellingPrice);
    await this.assertUniqueSkuAndBarcode(dto.sku, dto.barcode);

    return this.prisma.product.create({
      data: {
        sku: dto.sku,
        barcode: dto.barcode ?? null,
        name: dto.name,
        description: dto.description ?? null,
        categoryId: dto.categoryId ?? null,
        purchasePrice: dto.purchasePrice,
        sellingPrice: dto.sellingPrice,
        minimumStock: dto.minimumStock,
      },
      select: this.productSelect,
    });
  }

  async findAll(query: QueryProductDto) {
    const where: Prisma.ProductWhereInput = {
      deletedAt: null, // soft delete — deleted products are invisible everywhere
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
        select: this.productSelect,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
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

  async findOne(id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      select: this.productSelect,
    });
    if (!product) throw new NotFoundException('NOT_FOUND');
    return product;
  }

  async update(id: string, dto: UpdateProductDto) {
    // Ensure exists + not soft-deleted, and grab stored prices for validation.
    const current = await this.findOne(id);

    // Validate the merged price state — a PATCH may change only one side.
    const purchasePrice = dto.purchasePrice ?? Number(current.purchasePrice);
    const sellingPrice = dto.sellingPrice ?? Number(current.sellingPrice);
    this.assertValidPrice(purchasePrice, sellingPrice);

    if (dto.sku || dto.barcode) {
      await this.assertUniqueSkuAndBarcode(dto.sku, dto.barcode, id);
    }

    return this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.sku !== undefined && { sku: dto.sku }),
        ...(dto.barcode !== undefined && { barcode: dto.barcode }),
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
        ...(dto.purchasePrice !== undefined && { purchasePrice: dto.purchasePrice }),
        ...(dto.sellingPrice !== undefined && { sellingPrice: dto.sellingPrice }),
        ...(dto.minimumStock !== undefined && { minimumStock: dto.minimumStock }),
      },
      select: this.productSelect,
    });
  }

  async updateStatus(id: string, dto: UpdateStatusDto) {
    await this.findOne(id);
    return this.prisma.product.update({
      where: { id },
      data: { isActive: dto.isActive },
      select: this.productSelect,
    });
  }

  /** Soft delete — stamps deletedAt; the row stays for history/audit. */
  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: { ...this.productSelect, deletedAt: true },
    });
  }

  /** Selling price must never be below cost. */
  private assertValidPrice(purchase: number, selling: number) {
    if (selling < purchase) {
      throw new BadRequestException('PRICE_INVALID');
    }
  }

  /** SKU and barcode are unique across all products (even soft-deleted ones). */
  private async assertUniqueSkuAndBarcode(sku?: string, barcode?: string, excludeId?: string) {
    if (sku) {
      const hit = await this.prisma.product.findFirst({
        where: { sku, ...(excludeId ? { id: { not: excludeId } } : {}) },
        select: { id: true },
      });
      if (hit) throw new ConflictException('SKU_TAKEN');
    }
    if (barcode) {
      const hit = await this.prisma.product.findFirst({
        where: { barcode, ...(excludeId ? { id: { not: excludeId } } : {}) },
        select: { id: true },
      });
      if (hit) throw new ConflictException('BARCODE_TAKEN');
    }
  }

  private readonly productSelect = {
    id: true,
    sku: true,
    barcode: true,
    name: true,
    description: true,
    categoryId: true,
    purchasePrice: true,
    sellingPrice: true,
    minimumStock: true,
    stock: true,
    isActive: true,
    createdAt: true,
    updatedAt: true,
  } satisfies Prisma.ProductSelect;
}
