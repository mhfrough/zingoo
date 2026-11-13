import { Body, Controller, Get, Post, Query, Request } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsArray, IsOptional, IsUUID } from 'class-validator';
import { OwnState, Roles } from '../auth/roles.decorator';
import { ROLES } from '../common/enums';
import { NotificationsService } from './notifications.service';

export class MarkReadDto {
  /** leave out to mark everything read */
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) ids?: string[];
}

/** The bell: every login (staff, distributor, manufacturer) reads its own notices and what is waiting. */
@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  @Roles(...ROLES)
  @ApiQuery({ name: 'limit', required: false })
  @ApiOperation({ summary: 'Latest notices for this login, newest first, with the unread count' })
  list(@Request() req: any, @Query('limit') limit?: string) {
    return this.service.list(req.user, Number(limit) || 40);
  }

  @Get('counts')
  @Roles(...ROLES)
  @ApiOperation({ summary: 'Unread notices and open items this login has to act on' })
  counts(@Request() req: any) {
    return this.service.counts(req.user);
  }

  @Get('waiting')
  @Roles(...ROLES)
  @ApiOperation({ summary: 'Every open request this login can see, and who it waits on' })
  waiting(@Request() req: any) {
    return this.service.waiting(req.user);
  }

  @Post('read')
  @Roles(...ROLES)
  @OwnState()
  @ApiOperation({ summary: 'Mark notices read (all of them when no ids are sent)' })
  read(@Request() req: any, @Body() dto: MarkReadDto) {
    return this.service.markRead(req.user, dto.ids);
  }
}
