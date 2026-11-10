import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Read, Write } from '../auth/roles.decorator';
import { CreateVoucherDto } from './vouchers.dto';
import { VouchersService } from './vouchers.service';

@ApiTags('ledger')
@Controller('journal-vouchers')
export class VouchersController {
  constructor(private readonly service: VouchersService) {}

  @Get()
  @Read('ledger', 'accounting')
  @ApiOperation({ summary: 'Manual journal vouchers' })
  list() {
    return this.service.list();
  }

  @Post()
  @Write('finance')
  @ApiOperation({ summary: 'Post a multi-line voucher; debits and credits must be equal' })
  create(@Body() dto: CreateVoucherDto) {
    return this.service.create(dto);
  }

  @Post(':id/reverse')
  @Write('finance')
  @ApiOperation({ summary: 'Post an opposite voucher and mark the original Reversed' })
  reverse(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.reverse(id);
  }
}
