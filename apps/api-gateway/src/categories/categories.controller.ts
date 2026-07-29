import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AuthErrorResponseDto,
  CategoryDto,
  CategoryTreeDto,
  CreateCategoryDto,
  Public,
  Role,
  Roles,
  RmqClient,
  sendRpc,
  UpdateCategoryDto,
} from '@app/common';

@ApiTags('categories')
@Controller()
export class CategoriesController {
  constructor(
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
  ) {}

  @Public()
  @Get('categories')
  @ApiOperation({ summary: 'Faol kategoriyalarni daraxt ko‘rinishida olish' })
  @ApiOkResponse({ type: [CategoryTreeDto] })
  publicTree() {
    return sendRpc(this.catalog, { cmd: 'category.public-tree' }, {});
  }

  @Get('admin/categories')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Barcha kategoriyalarni daraxt ko‘rinishida olish' })
  @ApiOkResponse({ type: [CategoryTreeDto] })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  adminTree() {
    return sendRpc(this.catalog, { cmd: 'category.admin-tree' }, {});
  }

  @Post('admin/categories')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Kategoriya yaratish' })
  @ApiCreatedResponse({ type: CategoryDto })
  @ApiBadRequestResponse({ type: AuthErrorResponseDto })
  @ApiConflictResponse({ type: AuthErrorResponseDto })
  @ApiNotFoundResponse({ type: AuthErrorResponseDto })
  create(@Body() dto: CreateCategoryDto) {
    return sendRpc(this.catalog, { cmd: 'category.create' }, dto);
  }

  @Patch('admin/categories/:id')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Kategoriyani tahrirlash' })
  @ApiOkResponse({ type: CategoryDto })
  @ApiBadRequestResponse({ type: AuthErrorResponseDto })
  @ApiConflictResponse({ type: AuthErrorResponseDto })
  @ApiNotFoundResponse({ type: AuthErrorResponseDto })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCategoryDto,
  ) {
    return sendRpc(
      this.catalog,
      { cmd: 'category.update' },
      { id: String(id), dto },
    );
  }

  @Delete('admin/categories/:id')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Kategoriyani o‘chirish' })
  @ApiOkResponse({
    schema: {
      example: { id: '7', deleted: true },
    },
  })
  @ApiConflictResponse({ type: AuthErrorResponseDto })
  @ApiNotFoundResponse({ type: AuthErrorResponseDto })
  remove(@Param('id', ParseIntPipe) id: number) {
    return sendRpc(
      this.catalog,
      { cmd: 'category.delete' },
      { id: String(id) },
    );
  }
}
