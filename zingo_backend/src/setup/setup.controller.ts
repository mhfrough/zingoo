import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Write } from '../auth/roles.decorator';
import { AccountsService, CatalogListsService, CategoriesService, SettingsService } from './setup.service';
import { CreateCostCenterDto, SetBudgetDto, UpdateSettingsDto } from './setup.dto';

@ApiTags('setup')
@Controller()
export class SetupController {
  constructor(
    private readonly settings: SettingsService,
    private readonly accounts: AccountsService,
    private readonly categories: CategoriesService,
    private readonly lists: CatalogListsService,
  ) {}

  @Get('settings')
  getSettings() {
    return this.settings.get();
  }

  @Patch('settings')
  @Write('admin')
  @ApiOperation({ summary: 'Change assumptions (threshold, packs per carton ...). Re-checks pending approvals.' })
  updateSettings(@Body() dto: UpdateSettingsDto) {
    return this.settings.update(dto);
  }

  @Get('currencies')
  currencies() {
    return this.lists.currencyList();
  }

  @Get('container-types')
  containerTypes() {
    return this.lists.containerList();
  }

  @Get('accounts')
  @ApiOperation({ summary: 'Chart of accounts' })
  accountList() {
    return this.accounts.list();
  }

  @Get('categories')
  @ApiOperation({ summary: 'Cost centers (with budget), income and expense categories. ?kind=COST_CENTER|INCOME|EXPENSE' })
  categoryList(@Query('kind') kind?: string) {
    return this.categories.list(kind);
  }

  @Post('categories/cost-center')
  @Write('admin')
  createCostCenter(@Body() dto: CreateCostCenterDto) {
    return this.categories.createCostCenter(dto.name, dto.budget);
  }

  @Patch('categories/:id/budget')
  @Write('admin')
  setBudget(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetBudgetDto) {
    return this.categories.setBudget(id, dto.budget);
  }
}
