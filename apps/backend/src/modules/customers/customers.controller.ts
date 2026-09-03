import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Role } from '@ledgera/shared';
import { CustomersService } from './customers.service';
import { CreateCustomerDto, QueryCustomerDto, UpdateCustomerDto } from './dto';
import { Roles } from '../../common/decorators/roles.decorator';

/**
 * Customer Management API endpoints.
 *
 * POST /customers — Create customer (ADMIN, OWNER)
 * GET /customers — List customers (authenticated)
 * GET /customers/:id — Get customer detail with history (authenticated)
 * PUT /customers/:id — Update customer (ADMIN, OWNER)
 * DELETE /customers/:id — Soft-delete customer (ADMIN, OWNER)
 */
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  /**
   * POST /customers — Create a new customer
   * RBAC: ADMIN, OWNER
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.ADMIN, Role.OWNER)
  async create(@Body() dto: CreateCustomerDto) {
    return await this.customersService.create(dto);
  }

  /**
   * GET /customers — List customers with pagination and search
   * RBAC: All authenticated users
   */
  @Get()
  async findAll(@Query() query: QueryCustomerDto) {
    return await this.customersService.findAll(query);
  }

  /**
   * GET /customers/:id — Get customer detail with purchase history
   * RBAC: All authenticated users
   */
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return await this.customersService.findOne(id);
  }

  /**
   * PUT /customers/:id — Update customer
   * RBAC: ADMIN, OWNER
   */
  @Put(':id')
  @Roles(Role.ADMIN, Role.OWNER)
  async update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return await this.customersService.update(id, dto);
  }

  /**
   * DELETE /customers/:id — Soft-delete customer
   * RBAC: ADMIN, OWNER
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.ADMIN, Role.OWNER)
  async remove(@Param('id') id: string) {
    await this.customersService.remove(id);
  }
}
