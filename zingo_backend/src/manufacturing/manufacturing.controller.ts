import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Read, Write } from '../auth/roles.decorator';
import { CreateBatchDto, CreateMfrPaymentDto, UpdateBatchDto } from './manufacturing.dto';
import { BatchesService, MfrPaymentsService } from './manufacturing.service';

@ApiTags('manufacturing')
@Controller('batches')
export class BatchesController {
  constructor(private readonly service: BatchesService) {}

  @Get()
  @Read('manufacturing', 'accounting', 'finance')
  list() {
    return this.service.list();
  }

  @Get(':id')
  @Read('manufacturing', 'accounting', 'finance')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Write('manufacturing')
  create(@Body() dto: CreateBatchDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Write('manufacturing')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBatchDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Write('manufacturing')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }

  @Post(':id/release')
  @Write('manufacturing')
  @ApiOperation({ summary: 'Release a QC-passed batch into warehouse stock and accrue the manufacturer payable' })
  release(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.release(id);
  }
}

@ApiTags('manufacturing')
@Controller('manufacturer-payments')
export class MfrPaymentsController {
  constructor(private readonly service: MfrPaymentsService) {}

  @Get()
  @Read('manufacturing', 'accounting', 'finance')
  list() {
    return this.service.list();
  }

  @Post()
  @Write('manufacturing')
  @ApiOperation({ summary: 'Pay the manufacturer against a released batch' })
  create(@Body() dto: CreateMfrPaymentDto) {
    return this.service.create(dto);
  }
}
