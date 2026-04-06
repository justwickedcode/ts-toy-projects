import {
  Post,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Get,
  UseGuards,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { LoginDto } from './dto/login.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { JwtPayload } from './types/jwt-payload.type';
import { UsersService } from '../users/users.service';
import { GithubAuthGuard } from './guards/github-auth.guard';
import { SafeUser } from '../db/types/user.type';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { VerificationEmailDto } from '../email/dto/email.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/password-reset.dto';
import {
  VerifyMfaSetupDto,
  VerifyMfaLoginDto,
  DisableMfaDto,
} from './dto/mfa.dto';
import { ConfigService } from '@nestjs/config';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  private setRefreshCookie(res: Response, refreshToken: string) {
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: !(this.configService.getOrThrow('NODE_ENV') === 'dev'),
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/auth',
    });
  }

  // JWT

  @Post('register')
  @Public()
  async register(
    @Body() createUserDto: CreateUserDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.register(createUserDto);
    this.setRefreshCookie(res, result.refreshToken);
    return { user: result.user, accessToken: result.accessToken };
  }

  @Post('login')
  @Public()
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto);

    // MFA - no cookie, just pass through
    if ('requiresMFA' in result) {
      return result;
    }

    // Otherwise — set cookie, return only access token
    this.setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Public()
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.refreshToken as string;
    const result = await this.authService.refreshToken(refreshToken);
    this.setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken };
  }

  // Email verification

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(
    @CurrentUser() user: JwtPayload,
    @Body() dto: VerificationEmailDto,
  ) {
    return await this.authService.verifyEmail(user.sub, dto.code);
  }

  @Post('resend-verification-email')
  @HttpCode(HttpStatus.OK)
  async resendVerificationEmail(@CurrentUser() user: JwtPayload) {
    return await this.authService.resendVerificationCode(user.sub, user.email);
  }

  // Password reset

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Public()
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return await this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Public()
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return await this.authService.resetPassword(dto.token, dto.newPassword);
  }

  // MFA

  @Post('mfa/setup')
  @HttpCode(HttpStatus.OK)
  async setupMFA(@CurrentUser() user: JwtPayload) {
    return await this.authService.setupMFA(user.sub, user.email);
  }

  @Post('mfa/email/setup')
  @HttpCode(HttpStatus.OK)
  async setupEmailMFA(@CurrentUser() user: JwtPayload) {
    return await this.authService.setupEmailMFA(user.sub);
  }

  @Post('mfa/verify-setup')
  @HttpCode(HttpStatus.OK)
  async verifyMFASetup(
    @CurrentUser() user: JwtPayload,
    @Body() dto: VerifyMfaSetupDto,
  ) {
    return await this.authService.verifyMFASetup(
      user.sub,
      dto.code,
      dto.secret,
    );
  }

  @Post('mfa/verify-login')
  @HttpCode(HttpStatus.OK)
  @Public()
  async verifyMFALogin(
    @Body() dto: VerifyMfaLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.verifyMFALogin(
      dto.tempToken,
      dto.code,
      dto.method,
    );
    this.setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken };
  }

  @Post('mfa/regenerate-backup-codes')
  @HttpCode(HttpStatus.OK)
  async regenerateMFABackupCodes(@CurrentUser() user: JwtPayload) {
    return await this.authService.regenerateMFABackupCodes(user.sub);
  }

  @Post('mfa/disable')
  @HttpCode(HttpStatus.OK)
  async disableMFA(
    @CurrentUser() user: JwtPayload,
    @Body() dto: DisableMfaDto,
  ) {
    return await this.authService.disableMFA(user.sub, dto.password);
  }

  // GitHub

  @Get('github')
  @Public()
  @UseGuards(GithubAuthGuard)
  githubAuth() {}

  @Get('github/callback')
  @Public()
  @UseGuards(GithubAuthGuard)
  async githubCallback(@Req() req: Request, @Res() res: Response) {
    const result = await this.authService.loginOAuth(req.user as SafeUser);
    this.setRefreshCookie(res, result.refreshToken);
    res.redirect(this.configService.getOrThrow('FRONTEND_URL'));
  }

  // Google

  @Get('google')
  @Public()
  @UseGuards(GoogleAuthGuard)
  googleAuth() {}

  @Get('google/callback')
  @Public()
  @UseGuards(GoogleAuthGuard)
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    const result = await this.authService.loginOAuth(req.user as SafeUser);
    this.setRefreshCookie(res, result.refreshToken);
    res.redirect(this.configService.getOrThrow('FRONTEND_URL'));
  }

  // Logout

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res() res: Response) {
    const refreshToken = req.cookies?.refreshToken as string;
    if (refreshToken) {
      await this.authService.revokeRefreshToken(refreshToken);
    }
    return res
      .clearCookie('refreshToken', {
        httpOnly: true,
        secure: !(this.configService.getOrThrow('NODE_ENV') === 'dev'),
        sameSite: 'strict',
        path: '/auth',
      })
      .json({ success: true });
  }

  // Profile

  @Get('me')
  @HttpCode(HttpStatus.OK)
  getMe(@CurrentUser() user: JwtPayload) {
    return this.userService.findOne(user.sub);
  }
}
