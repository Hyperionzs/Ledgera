import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { QuerySupplierDto } from './dto/query-supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateSupplierDto) {
    const name = this.normalize(dto.name);
    if (!name) throw new BadRequestException('SUPPLIER_NAME_REQUIRED');
    await this.assertUniqueName(name);
    const email = this.normalizeEmail(dto.email);
    if (email) await this.assertUniqueEmail(email);

    return this.prisma.supplier.create({
      data: {
        name,
        contactName: this.normalize(dto.contactName),
        phone: this.normalize(dto.phone),
        email,
        address: this.normalize(dto.address),
      },
      select: this.supplierSelect,
    });
  }

  async findAll(query: QuerySupplierDto) {
    const where: Prisma.SupplierWhereInput = {
      deletedAt: null,
      ...(query.search && {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { contactName: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
      ...(query.isActive !== undefined && { isActive: query.isActive }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.supplier.findMany({
        where,
        select: this.supplierSelect,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.supplier.count({ where }),
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
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, deletedAt: null },
      select: this.supplierSelect,
    });
    if (!supplier) throw new NotFoundException('SUPPLIER_NOT_FOUND');
    return supplier;
  }

  async update(id: string, dto: UpdateSupplierDto) {
    await this.findOne(id); // exists + not soft-deleted

    const name = dto.name !== undefined ? this.normalize(dto.name) : undefined;
    if (name === undefined && dto.name !== undefined) {
      throw new BadRequestException('SUPPLIER_NAME_REQUIRED');
    }
    if (name !== undefined) await this.assertUniqueName(name, id);

    const email = dto.email !== undefined ? this.normalizeEmail(dto.email) : undefined;
    if (email) await this.assertUniqueEmail(email, id);

    return this.prisma.supplier.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(dto.contactName !== undefined && {
          contactName: this.normalize(dto.contactName),
        }),
        ...(dto.phone !== undefined && { phone: this.normalize(dto.phone) }),
        ...(email !== undefined && { email }),
        ...(dto.address !== undefined && { address: this.normalize(dto.address) }),
      },
      select: this.supplierSelect,
    });
  }

  async updateStatus(id: string, isActive: boolean) {
    await this.findOne(id);
    return this.prisma.supplier.update({
      where: { id },
      data: { isActive },
      select: this.supplierSelect,
    });
  }

  /** Soft delete — row stays for history; name/email may be reused. */
  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.supplier.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: { ...this.supplierSelect, deletedAt: true },
    });
  }

  // ---------------------------------------------------------------------------
  // Guards & helpers
  // ---------------------------------------------------------------------------

  /**
   * Normalizes free-text: trims outer whitespace and collapses runs of inner
   * whitespace to a single space. Empty after normalization becomes undefined,
   * so "   " and "" behave the same as "not provided".
   */
  private normalize(value?: string): string | undefined {
    if (value == null) return undefined;
    const normalized = value.trim().replace(/\s+/g, ' ');
    return normalized.length ? normalized : undefined;
  }

  private normalizeEmail(value?: string): string | undefined {
    return this.normalize(value)?.toLowerCase();
  }

  /** name is unique among active suppliers, case- and whitespace-insensitive. */
  private async assertUniqueName(name: string, excludeId?: string) {
    const hit = await this.prisma.supplier.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (hit) throw new ConflictException('SUPPLIER_NAME_TAKEN');
  }

  /** email is unique among active suppliers when provided (stored lowercase). */
  private async assertUniqueEmail(email: string, excludeId?: string) {
    const hit = await this.prisma.supplier.findFirst({
      where: {
        email,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (hit) throw new ConflictException('SUPPLIER_EMAIL_TAKEN');
  }

  private readonly supplierSelect = {
    id: true,
    name: true,
    contactName: true,
    phone: true,
    email: true,
    address: true,
    isActive: true,
    createdAt: true,
    updatedAt: true,
  } satisfies Prisma.SupplierSelect;
}
