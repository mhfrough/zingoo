import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Request } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles, Write } from '../auth/roles.decorator';
import { STAFF } from '../auth/access';
import { LookupsService } from './lookups.service';
import { AccountsService, CatalogListsService, CategoriesService, SettingsService } from './setup.service';
import {
  CreateAccountDto, CreateCategoryDto, CreateContainerDto, CreateCostCenterDto, CreateCurrencyDto, CreateLookupDto, RenameCategoryDto,
  SetBudgetDto, SetStreamDto, UpdateAccountDto, UpdateContainerDto, UpdateCurrencyDto, UpdateLookupDto, UpdateSettingsDto,
} from './setup.dto';

@ApiTags('setup')
@Controller()
export class SetupController {
  constructor(
    private readonly settings: SettingsService,
    private readonly accounts: AccountsService,
    private readonly categories: CategoriesService,
    private readonly lists: CatalogListsService,
    private readonly lookups: LookupsService,
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

  @Post('accounts')
  @Write('finance')
  @ApiOperation({ summary: 'Add an account to the chart of accounts' })
  addAccount(@Body() dto: CreateAccountDto) {
    return this.accounts.create(dto);
  }

  @Patch('accounts/:id')
  @Write('finance')
  @ApiOperation({ summary: 'Rename or switch off an account' })
  editAccount(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAccountDto) {
    return this.accounts.update(id, dto);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Cost centers (with budget), income and expense categories. ?kind=COST_CENTER|INCOME|EXPENSE' })
  categoryList(@Query('kind') kind?: string) {
    return this.categories.list(kind);
  }

  @Post('categories/cost-center')
  @Write('admin')
  createCostCenter(@Body() dto: CreateCostCenterDto) {
    return this.categories.createCostCenter(dto.name, dto.budget, dto.streamType, dto.depreciationRate);
  }

  @Patch('categories/:id/stream')
  @Write('admin')
  @ApiOperation({ summary: 'Set the type of an investment stream (and its depreciation rate)' })
  setStream(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetStreamDto) {
    return this.categories.setStream(id, dto.streamType, dto.depreciationRate);
  }

  @Patch('categories/:id/budget')
  @Write('admin')
  setBudget(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetBudgetDto) {
    return this.categories.setBudget(id, dto.budget);
  }

  @Post('categories')
  @Write('admin')
  @ApiOperation({ summary: 'Add an income or expense category' })
  addCategory(@Body() dto: CreateCategoryDto) {
    return this.categories.create(dto.kind, dto.name);
  }

  @Patch('categories/:id')
  @Write('admin')
  @ApiOperation({ summary: 'Rename a category; documents and its ledger account follow' })
  renameCategory(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RenameCategoryDto) {
    return this.categories.rename(id, dto.name);
  }

  @Delete('categories/:id')
  @Write('admin')
  @ApiOperation({ summary: 'Delete a category no document uses' })
  deleteCategory(@Param('id', ParseUUIDPipe) id: string) {
    return this.categories.remove(id);
  }

  // ── currencies and containers ──

  @Post('currencies')
  @Write('admin')
  addCurrency(@Request() req: any, @Body() dto: CreateCurrencyDto) {
    return this.lists.addCurrency(dto, req.user?.name);
  }

  @Patch('currencies/:code')
  @Roles('Admin', 'Finance')
  @ApiOperation({ summary: 'Change a currency name, symbol or exchange rate (PKR per unit); Finance may override the rate' })
  editCurrency(@Request() req: any, @Param('code') code: string, @Body() dto: UpdateCurrencyDto) {
    return this.lists.updateCurrency(code, dto, req.user?.name);
  }

  @Get('currencies/:code/rates')
  @Roles(...STAFF)
  @ApiOperation({ summary: 'Every exchange rate the currency has had, with its source and who set it' })
  currencyRates(@Param('code') code: string) {
    return this.lists.rateHistory(code);
  }

  @Delete('currencies/:code')
  @Write('admin')
  deleteCurrency(@Param('code') code: string) {
    return this.lists.removeCurrency(code);
  }

  @Post('container-types')
  @Write('admin')
  addContainer(@Body() dto: CreateContainerDto) {
    return this.lists.addContainer(dto);
  }

  @Patch('container-types/:code')
  @Write('admin')
  editContainer(@Param('code') code: string, @Body() dto: UpdateContainerDto) {
    return this.lists.updateContainer(code, dto.maxCartons);
  }

  @Delete('container-types/:code')
  @Write('admin')
  deleteContainer(@Param('code') code: string) {
    return this.lists.removeContainer(code);
  }

  // ── pick-lists: payment methods and Incoterms ──

  @Get('lookups')
  @ApiOperation({ summary: 'Editable pick-lists (PAY_METHOD, INCOTERM). ?list=PAY_METHOD' })
  lookupList(@Query('list') list?: string) {
    return this.lookups.list(list);
  }

  @Post('lookups')
  @Write('admin')
  addLookup(@Body() dto: CreateLookupDto) {
    return this.lookups.create(dto);
  }

  @Patch('lookups/:id')
  @Write('admin')
  @ApiOperation({ summary: 'Change the text or the seller cost lines of an entry, or switch it off' })
  editLookup(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLookupDto) {
    return this.lookups.update(id, dto);
  }
}
