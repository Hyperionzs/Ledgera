import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateCustomerDto, QueryCustomerDto, UpdateCustomerDto } from './dto';

/**
 * Customer Management — handles customer registration, lookup, and purchase history.
 *
 * Key responsibilities:
 * - Create customer with validation (name required, email unique)
 * - List customers with pagination and search
 * - Fetch customer detail with sale history and statistics
 * - Update customer (soft-update only, no history mutation)
 * - Soft-delete customer (never physically removed)
 * - Protect Walk-in sentinel customer from deletion
 */
@Injectable()
export class CustomersService {
  // Walk-in sentinel customer UUID
  private readonly WALKIN_CUSTOMER_ID = '00000000-0000-0000-0000-000000000000';

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new customer.
   *
   * Validates:
   * - name is not empty
   * - email is unique among active customers (if provided)
   */
  async create(dto: CreateCustomerDto) {
    // Validate name
    if (!dto.name || dto.name.trim().length === 0) {
      throw new BadRequestException('Customer name is required');
    }

    // If email provided, check uniqueness among active customers
    if (dto.email) {
      const existing = await this.prisma.customer.findFirst({
        where: {
          email: dto.email,
          isActive: true,
          deletedAt: null,
        },
      });

      if (existing) {
        throw new BadRequestException('Email already in use');
      }
    }

    const customer = await this.prisma.customer.create({
      data: {
        name: dto.name.trim(),
        email: dto.email ? dto.email.trim().toLowerCase() : null,
        phone: dto.phone ? dto.phone.trim() : null,
        address: dto.address ? dto.address.trim() : null,
        city: dto.city ? dto.city.trim() : null,
        notes: dto.notes ? dto.notes.trim() : null,
        isActive: true,
        deletedAt: null,
      },
    });

    return customer;
  }

  /**
   * List all active customers with pagination and search.
   *
   * Search matches name, email, or phone (case-insensitive, contains).
   * Results exclude soft-deleted customers.
   */
  async findAll(query: QueryCustomerDto) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const where: Prisma.CustomerWhereInput = {
      isActive: true,
      deletedAt: null,
      ...(query.search && {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { email: { contains: query.search, mode: 'insensitive' } },
          { phone: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          address: true,
          city: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.customer.count({ where }),
    ]);

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get customer detail by id with purchase history and statistics.
   *
   * Includes:
   * - Customer profile
   * - All sales linked to this customer (newest first)
   * - Statistics: total sales, total spent, last purchase date
   *
   * Throws NotFoundException if customer not found or deleted.
   */
  async findOne(id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: {
        id,
        isActive: true,
        deletedAt: null,
      },
      include: {
        sales: {
          select: {
            id: true,
            referenceNo: true,
            totalAmount: true,
            createdAt: true,
            items: {
              select: { id: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('CUSTOMER_NOT_FOUND');
    }

    // Calculate statistics
    const totalSales = customer.sales.length;
    let totalSpent = new Prisma.Decimal(0);
    let lastPurchaseAt: Date | null = null;

    if (customer.sales.length > 0) {
      for (const sale of customer.sales) {
        totalSpent = totalSpent.add(sale.totalAmount);
      }
      lastPurchaseAt = customer.sales[0].createdAt; // newest first
    }

    return {
      ...customer,
      sales: customer.sales.map((sale) => ({
        id: sale.id,
        referenceNo: sale.referenceNo,
        totalAmount: sale.totalAmount,
        createdAt: sale.createdAt,
        itemCount: sale.items.length,
      })),
      stats: {
        totalSales,
        totalSpent: totalSpent.toString(),
        lastPurchaseAt,
      },
    };
  }

  /**
   * Update an existing customer.
   *
   * Only updates name/contact info. Does not affect historical sales.
   * Validates email uniqueness if changing it.
   * Throws NotFoundException if customer not found or deleted.
   */
  async update(id: string, dto: UpdateCustomerDto) {
    const customer = await this.prisma.customer.findFirst({
      where: {
        id,
        isActive: true,
        deletedAt: null,
      },
    });

    if (!customer) {
      throw new NotFoundException('CUSTOMER_NOT_FOUND');
    }

    // If email is being changed, verify uniqueness
    if (dto.email && dto.email !== customer.email) {
      const existing = await this.prisma.customer.findFirst({
        where: {
          email: dto.email,
          isActive: true,
          deletedAt: null,
          NOT: { id },
        },
      });

      if (existing) {
        throw new BadRequestException('Email already in use');
      }
    }

    const updated = await this.prisma.customer.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.email !== undefined && {
          email: dto.email ? dto.email.trim().toLowerCase() : null,
        }),
        ...(dto.phone !== undefined && {
          phone: dto.phone ? dto.phone.trim() : null,
        }),
        ...(dto.address !== undefined && {
          address: dto.address ? dto.address.trim() : null,
        }),
        ...(dto.city !== undefined && {
          city: dto.city ? dto.city.trim() : null,
        }),
        ...(dto.notes !== undefined && {
          notes: dto.notes ? dto.notes.trim() : null,
        }),
        updatedAt: new Date(),
      },
    });

    return updated;
  }

  /**
   * Soft-delete a customer (set deletedAt and isActive=false).
   *
   * Prevents deletion of Walk-in sentinel customer.
   * Historical sales remain intact.
   * Throws NotFoundException if customer not found or already deleted.
   */
  async remove(id: string) {
    // Prevent deletion of Walk-in sentinel
    if (id === this.WALKIN_CUSTOMER_ID) {
      throw new BadRequestException('Cannot delete Walk-in customer');
    }

    const customer = await this.prisma.customer.findFirst({
      where: {
        id,
        isActive: true,
        deletedAt: null,
      },
    });

    if (!customer) {
      throw new NotFoundException('CUSTOMER_NOT_FOUND');
    }

    await this.prisma.customer.update({
      where: { id },
      data: {
        isActive: false,
        deletedAt: new Date(),
      },
    });
  }
}
