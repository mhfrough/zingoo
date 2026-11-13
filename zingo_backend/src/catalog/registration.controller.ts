import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Request } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../auth/roles.decorator';
import { STAFF } from '../auth/access';
import { APPROVAL_STEPS, ApprovalStep, RegistrationService } from './registration.service';

class ApproveDto {
  @IsIn(Object.keys(APPROVAL_STEPS)) step: ApprovalStep;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class RegistrationReasonDto {
  @IsString() @IsNotEmpty() @MaxLength(500) reason: string;
}

class StateDto {
  @IsIn(['On hold', 'Suspended', 'Archived', 'Active']) to: 'On hold' | 'Suspended' | 'Archived' | 'Active';
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

/**
 * Registration of an international distributor: submit, review, the Sales / Finance / Compliance sign-offs,
 * activate, hold, suspend, archive. Each route checks the role for its step; the service checks the order.
 */
@ApiTags('distributors')
@Controller('distributors/:id/registration')
export class RegistrationController {
  constructor(private readonly service: RegistrationService) {}

  @Get()
  @Roles(...STAFF)
  @ApiOperation({ summary: 'Status, what is missing, the sign-offs and the trail' })
  state(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.state(id);
  }

  @Post('submit')
  @Roles('Admin', 'Distribution', 'Exports')
  submit(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.submit(req.user, id);
  }

  @Post('review')
  @Roles('Admin', 'Finance')
  review(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.review(req.user, id);
  }

  @Post('approve')
  @Roles('Admin', 'Finance', 'Distribution', 'Exports')
  @ApiOperation({ summary: 'Give the Sales, Finance or Compliance sign-off' })
  approve(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveDto) {
    return this.service.approve(req.user, id, dto.step, dto.note);
  }

  @Post('reject')
  @Roles('Admin', 'Finance', 'Distribution', 'Exports')
  reject(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RegistrationReasonDto) {
    return this.service.reject(req.user, id, dto.reason);
  }

  @Post('activate')
  @Roles('Admin')
  activate(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.activate(req.user, id);
  }

  @Post('state')
  @Roles('Admin', 'Finance')
  @ApiOperation({ summary: 'Put on hold, suspend, archive, or resume (Active)' })
  setState(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StateDto) {
    return this.service.setState(req.user, id, dto.to, dto.reason);
  }

  @Post('reopen')
  @Roles('Admin')
  reopen(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.reopen(req.user, id);
  }
}
