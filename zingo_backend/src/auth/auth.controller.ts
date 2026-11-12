import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Request } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './login.dto';
import { Public } from './public.decorator';
import { Roles, Write } from './roles.decorator';
import { ROLES, Role } from '../common/enums';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Login -> JWT token' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Get('view-as')
  @Write('admin')
  @ApiOperation({ summary: 'Logins and roles an Admin can switch to' })
  viewAsOptions() {
    return this.auth.viewAsOptions();
  }

  @Post('switch-role/:role')
  @Write('admin')
  @ApiOperation({ summary: 'Switch to a login of a role (one is made when the role has none)' })
  switchRole(@Request() req: any, @Param('role') role: Role) {
    return this.auth.switchToRole(req.user.id, role);
  }

  @Post('view-as/:id')
  @Write('admin')
  @ApiOperation({ summary: 'Switch to another login without signing in again' })
  viewAs(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.auth.viewAs(req.user.id, id);
  }

  @Get('me')
  @Roles(...ROLES)
  @ApiOperation({ summary: 'Logged-in user (any role, partner logins too)' })
  me(@Request() req: any) {
    return this.auth.me(req.user.id);
  }
}
