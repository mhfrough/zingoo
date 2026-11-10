import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Request } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLE_PAGES, WRITE_ROLES } from '../auth/access';
import { Read, Write } from '../auth/roles.decorator';
import { CreateUserDto, ResetPasswordDto, UpdateUserDto } from './users.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get()
  @Read('users')
  @ApiOperation({ summary: 'Logins with role, signing seat and status (never the password)' })
  list() {
    return this.service.list();
  }

  /** which page each role can open and which kinds of change it can make (read-only; roles are fixed in the app) */
  @Get('access')
  @Read('users')
  access() {
    return { pages: ROLE_PAGES, writes: WRITE_ROLES };
  }

  @Post()
  @Write('admin')
  create(@Body() dto: CreateUserDto) {
    return this.service.add(dto);
  }

  @Patch(':id')
  @Write('admin')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @Request() req: any) {
    return this.service.edit(id, dto, req.user.id);
  }

  @Post(':id/reset-password')
  @Write('admin')
  @ApiOperation({ summary: 'Set a new password for a login' })
  resetPassword(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResetPasswordDto) {
    return this.service.resetPassword(id, dto.password);
  }
}
