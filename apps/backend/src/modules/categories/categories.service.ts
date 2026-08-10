import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { QueryCategoryDto } from './dto/query-category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCategoryDto) {
    await this.assertUniqueName(dto.name, dto.parentId);
    if (dto.parentId) {
      await this.assertParentUsable(dto.parentId);
    }
    return this.prisma.category.create({
      data: { name: dto.name, parentId: dto.parentId ?? null, description: dto.description },
      select: this.categorySelect,
    });
  }

  /**
   * Returns the active category tree. A single SELECT then an in-memory build —
   * avoids recursive queries and stays fast even with many categories.
   */
  async findTree(query: QueryCategoryDto) {
    const where: Prisma.CategoryWhereInput = this.buildWhere(query.search);
    const [categories, total] = await this.prisma.$transaction([
      this.prisma.category.findMany({
        where,
        select: this.categorySelect,
        orderBy: { name: 'asc' },
      }),
      this.prisma.category.count({ where }),
    ]);

    return { items: this.buildTree(categories), meta: { total } };
  }

  async findOne(id: string) {
    const category = await this.prisma.category.findFirst({
      where: { id, deletedAt: null },
      select: this.categorySelect,
    });
    if (!category) throw new NotFoundException('CATEGORY_NOT_FOUND');

    const [childCount, productCount] = await this.prisma.$transaction([
      this.prisma.category.count({ where: { parentId: id, deletedAt: null } }),
      this.prisma.product.count({ where: { categoryId: id, deletedAt: null } }),
    ]);

    return {
      id: category.id,
      name: category.name,
      parentId: category.parentId,
      description: category.description,
      isActive: category.isActive,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
      parent: category.parentId
        ? await this.prisma.category.findFirst({
            where: { id: category.parentId, deletedAt: null },
            select: { id: true, name: true },
          })
        : null,
      children: await this.prisma.category.findMany({
        where: { parentId: id, deletedAt: null },
        select: { id: true, name: true, isActive: true },
        orderBy: { name: 'asc' },
      }),
      childCount,
      productCount,
    };
  }

  async update(id: string, dto: UpdateCategoryDto) {
    await this.findOne(id); // ensures exists + not soft-deleted

    // Determine the effective parent after this update (undefined => unchanged).
    const newParentId =
      dto.parentId !== undefined
        ? // Works through the stored parentId for sibling-scoped uniqueness.
          dto.parentId
        : undefined;

    if (dto.parentId !== undefined) {
      if (dto.parentId !== null) {
        await this.assertParentUsable(dto.parentId);
        if (dto.parentId === id) throw new BadRequestException('INVALID_PARENT');
        await this.assertNotDescendant(id, dto.parentId);
      }
    }
    if (dto.name !== undefined) {
      // When parent is unchanged, uniqueness is checked against current parent.
      const current = newParentId === undefined ? (await this.findOne(id)).parentId : newParentId;
      await this.assertUniqueName(dto.name, current, id);
    }

    return this.prisma.category.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.parentId !== undefined && { parentId: dto.parentId }),
        ...(dto.description !== undefined && { description: dto.description }),
      },
      select: this.categorySelect,
    });
  }

  /**
   * Flips active status for this category only — children are intentionally
   * left untouched (a disabled parent does not force-disable its tree).
   */
  async updateStatus(id: string, isActive: boolean) {
    await this.findOne(id);
    return this.prisma.category.update({
      where: { id },
      data: { isActive },
      select: this.categorySelect,
    });
  }

  /**
   * Soft delete. Walks the subtree (BFS/collect) — if any category in the
   * subtree is still used by a non-deleted product, the whole operation is
   * rejected (CATEGORY_IN_USE). Otherwise every subtree row gets deletedAt.
   */
  async remove(id: string) {
    await this.findOne(id);
    const subtreeIds = await this.collectSubtreeIds(id);
    const used = await this.prisma.product.count({
      where: { categoryId: { in: subtreeIds }, deletedAt: null },
    });
    if (used > 0) throw new ConflictException('CATEGORY_IN_USE');

    await this.prisma.category.updateMany({
      where: { id: { in: subtreeIds } },
      data: { deletedAt: new Date() },
    });
    return { id, deletedAt: new Date() };
  }

  // ---------------------------------------------------------------------------
  // Guards & helpers
  // ---------------------------------------------------------------------------

  private buildWhere(search?: string): Prisma.CategoryWhereInput {
    return {
      deletedAt: null,
      ...(search && { name: { contains: search, mode: 'insensitive' } }),
    };
  }

  /** Builds the tree in memory from a flat list. Roots = categories without an active parent. */
  private buildTree(
    rows: { id: string; name: string; parentId: string | null; isActive: boolean }[],
  ) {
    const childrenOf = new Map<string, typeof rows>();
    rows.forEach((r) => {
      const list = childrenOf.get(r.parentId ?? '') ?? [];
      list.push(r);
      childrenOf.set(r.parentId ?? '', list);
    });
    const roots = childrenOf.get('') ?? [];
    const attach = (node: (typeof rows)[number]): Record<string, unknown> => ({
      id: node.id,
      name: node.name,
      parentId: node.parentId,
      isActive: node.isActive,
      children: (childrenOf.get(node.id) ?? []).map(attach),
    });
    return roots.map(attach);
  }

  /** A name is unique among non-deleted siblings (same parent) — case-insensitive. */
  private async assertUniqueName(
    name: string,
    parentId: string | null | undefined,
    excludeId?: string,
  ) {
    const hit = await this.prisma.category.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(parentId === null || parentId === undefined ? { parentId: null } : { parentId }),
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (hit) throw new ConflictException('CATEGORY_NAME_TAKEN');
  }

  /** Parent must exist and must not be soft-deleted. */
  private async assertParentUsable(parentId: string) {
    const parent = await this.prisma.category.findFirst({
      where: { id: parentId, deletedAt: null },
      select: { id: true },
    });
    if (!parent) throw new BadRequestException('INVALID_PARENT');
  }

  /**
   * Cycle guard — walks UP from candidate parent. If we reach the category
   * being moved, then newParentId is inside its own subtree. Moving a node
   * under its own descendant would create a cycle. Walking up is cheaper than
   * walking the whole subtree down.
   */
  private async assertNotDescendant(id: string, newParentId: string) {
    let cursor: string | null = newParentId;
    const visited = new Set<string>();
    while (cursor && !visited.has(cursor)) {
      if (cursor === id) throw new BadRequestException('INVALID_PARENT');
      visited.add(cursor);
      const row: { parentId: string | null } | null = await this.prisma.category.findFirst({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = row?.parentId ?? null;
    }
  }

  /** BFS — collects the target id plus every descendant id (deleted or not). */
  private async collectSubtreeIds(id: string): Promise<string[]> {
    const all: string[] = [];
    const queue = [id];
    while (queue.length) {
      const current = queue.shift()!;
      all.push(current);
      const children = await this.prisma.category.findMany({
        where: { parentId: current },
        select: { id: true },
      });
      children.forEach((c) => queue.push(c.id));
    }
    return all;
  }

  private readonly categorySelect = {
    id: true,
    name: true,
    parentId: true,
    description: true,
    isActive: true,
    createdAt: true,
    updatedAt: true,
  } satisfies Prisma.CategorySelect;
}
