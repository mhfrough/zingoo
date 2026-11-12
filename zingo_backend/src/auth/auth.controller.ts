import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Request } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './login.dto';
import { Public } from './public.decorator';
import { Write } from './roles.decorator';

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
  @ApiOperation({ summary: 'Logins an Admin can preview the app as' })
  viewAsOptions() {
    return this.auth.viewAsOptions();
  }

  @Post('view-as/:id')
  @Write('admin')
  @ApiOperation({ summary: 'A read-only token to see the app as another login' })
  viewAs(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.auth.viewAs(req.user.id, id);
  }

  @Get('me')
  @ApiOperation({ summary: 'Logged-in user' })
  me(@Request() req: any) {
    return this.auth.me(req.user.id);
  }
}
