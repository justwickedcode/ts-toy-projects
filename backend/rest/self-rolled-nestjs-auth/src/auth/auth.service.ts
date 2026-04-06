import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { CreateUserDto } from '../users/dto/create-user.dto';
import * as bcrypt from 'bcrypt';
import * as crypto from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { LoginDto } from './dto/login.dto';
import { SafeUser } from '../db/types/user.type';
import { verificationCodesTable } from '../db/schemas/verification_codes.schema';
import { DbService } from '../db/db.service';
import { EmailService } from '../email/email.service';
import { usersTable } from '../db/schemas/users.schema';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { passwordResetTokensTable } from '../db/schemas/password_reset_tokens.schema';
import { TOTP, Secret } from 'otpauth';
import * as QRCode from 'qrcode';
import { refreshTokensTable } from '../db/schemas/refresh_tokens.schema';
import { mfaBackupCodesTable } from '../db/schemas/mfa_backup_codes.schema';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly db: DbService,
    private readonly email: EmailService,
  ) {}

  private async createAndSendCode(
    userId: number,
    email: string,
    type: 'mfa' | 'email_validation',
  ) {
    const code = crypto.randomInt(100000, 999999).toString();
    await this.db.drizzle.insert(verificationCodesTable).values({
      user_id: userId,
      code,
      type,
      expires_at:
        type === 'email_validation'
          ? new Date(Date.now() + 10 * 60 * 1000)
          : new Date(Date.now() + 5 * 60 * 1000),
    });
    if (type === 'email_validation')
      await this.email.sendVerificationCode(email, code);

    if (type === 'mfa') await this.email.sendMfaCode(email, code);
  }

  private async generateTokens(userId: number, email: string) {
    const accessToken = this.jwtService.sign(
      { sub: userId, email },
      { expiresIn: '15m' },
    );

    const refreshToken = crypto.randomBytes(32).toString('hex');
    const hashedRefreshToken = crypto
      .createHash('sha256')
      .update(refreshToken)
      .digest('hex');

    await this.db.drizzle.insert(refreshTokensTable).values({
      user_id: userId,
      token_hash: hashedRefreshToken,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    return { accessToken, refreshToken };
  }

  public async refreshToken(refreshToken: string) {
    const hashedRefreshToken = crypto
      .createHash('sha256')
      .update(refreshToken)
      .digest('hex');

    const token = await this.db.drizzle
      .select()
      .from(refreshTokensTable)
      .where(eq(refreshTokensTable.token_hash, hashedRefreshToken))
      .limit(1);

    if (!token[0]) throw new UnauthorizedException('Invalid refresh token.');

    // Stolen token — already used, nuke everything for this user
    if (token[0].used_at) {
      await this.db.drizzle
        .delete(refreshTokensTable)
        .where(eq(refreshTokensTable.user_id, token[0].user_id));
      throw new UnauthorizedException(
        'Token reuse detected. Please log in again.',
      );
    }

    // Expired
    if (token[0].expires_at < new Date()) {
      throw new UnauthorizedException('Refresh token expired.');
    }

    await this.db.drizzle
      .update(refreshTokensTable)
      .set({ used_at: new Date() })
      .where(eq(refreshTokensTable.id, token[0].id));
    const user = await this.usersService.findOne(token[0].user_id);
    return await this.generateTokens(user.id, user.email);
  }

  async revokeRefreshToken(refreshToken: string) {
    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await this.db.drizzle
      .update(refreshTokensTable)
      .set({ used_at: new Date() })
      .where(eq(refreshTokensTable.token_hash, hash));
  }

  async register(dto: CreateUserDto) {
    const createdUser = await this.usersService.create(dto);
    await this.createAndSendCode(
      createdUser.id,
      createdUser.email,
      'email_validation',
    );
    const token = await this.generateTokens(createdUser.id, createdUser.email);
    return {
      user: createdUser,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
    };
  }

  // e-mail verification

  async resendVerificationCode(userId: number, email: string) {
    const isEmailVerified = await this.usersService.isEmailVerified(userId);
    if (isEmailVerified)
      throw new BadRequestException('Email is already verified.');
    await this.createAndSendCode(userId, email, 'email_validation');
  }

  public async verifyEmail(userId: number, code: string): Promise<boolean> {
    const emailVerificationCode = await this.db.drizzle
      .select()
      .from(verificationCodesTable)
      .where(
        and(
          eq(verificationCodesTable.user_id, userId),
          eq(verificationCodesTable.type, 'email_validation'),
          isNull(verificationCodesTable.used_at),
          gt(verificationCodesTable.expires_at, new Date()),
        ),
      )
      .orderBy(desc(verificationCodesTable.created_at))
      .limit(1);

    if (!emailVerificationCode[0]) return false;
    if (emailVerificationCode[0].code === code) {
      // flag code as used
      await this.db.drizzle
        .update(verificationCodesTable)
        .set({ used_at: new Date() })
        .where(eq(verificationCodesTable.id, emailVerificationCode[0].id));

      // flag user's email as verified
      await this.db.drizzle
        .update(usersTable)
        .set({ is_email_verified: true })
        .where(eq(usersTable.id, userId));
      return true;
    }

    return false;
  }

  public async verifyEmailMfa(userId: number, code: string): Promise<boolean> {
    const emailVerificationCode = await this.db.drizzle
      .select()
      .from(verificationCodesTable)
      .where(
        and(
          eq(verificationCodesTable.user_id, userId),
          eq(verificationCodesTable.type, 'mfa'),
          isNull(verificationCodesTable.used_at),
          gt(verificationCodesTable.expires_at, new Date()),
        ),
      )
      .orderBy(desc(verificationCodesTable.created_at))
      .limit(1);

    if (!emailVerificationCode[0]) return false;
    if (emailVerificationCode[0].code === code) {
      // flag code as used
      await this.db.drizzle
        .update(verificationCodesTable)
        .set({ used_at: new Date() })
        .where(eq(verificationCodesTable.id, emailVerificationCode[0].id));
      return true;
    }

    return false;
  }

  public async verifyMFABackupCode(
    userId: number,
    code: string,
  ): Promise<boolean> {
    const backupMFACode = await this.db.drizzle
      .select()
      .from(mfaBackupCodesTable)
      .where(
        and(
          eq(mfaBackupCodesTable.user_id, userId),
          isNull(mfaBackupCodesTable.used_at),
          eq(mfaBackupCodesTable.code, code),
        ),
      );

    if (!backupMFACode[0]) return false;

    await this.db.drizzle
      .update(mfaBackupCodesTable)
      .set({ used_at: new Date() })
      .where(eq(mfaBackupCodesTable.id, backupMFACode[0].id));

    return true;
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findForAuth(dto.login);
    const isValid = await bcrypt.compare(dto.password, user.password);
    if (!isValid)
      throw new UnauthorizedException('Wrong email/username or password');
    if (!user.mfa_active) {
      return await this.generateTokens(user.id, user.email);
    }
    if (user.mfa_default_method === 'email')
      await this.createAndSendCode(user.id, user.email, 'mfa');

    const tempToken = this.jwtService.sign(
      { sub: user.id, type: 'mfa' },
      { expiresIn: '5m' },
    );
    return { requiresMFA: true, tempToken };
  }

  // password reset

  async forgotPassword(email: string) {
    // verify is user exists
    const exists = await this.usersService.queryUserByEmail(email);
    if (!exists) return { message: 'Reset email sent.' };

    const token = crypto.randomBytes(32).toString('hex');

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    await this.db.drizzle.insert(passwordResetTokensTable).values({
      token_hash: tokenHash,
      user_id: exists.id,
      expires_at: new Date(Date.now() + 10 * 60 * 1000),
    });

    await this.email.sendPasswordResetLink(email, token);

    return { message: 'Reset email sent.' };
  }

  async resetPassword(token: string, newPassword: string) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const tokenExists = await this.db.drizzle
      .select()
      .from(passwordResetTokensTable)
      .where(
        and(
          eq(passwordResetTokensTable.token_hash, tokenHash),
          gt(passwordResetTokensTable.expires_at, new Date()),
          isNull(passwordResetTokensTable.used_at),
        ),
      )
      .limit(1);
    if (!tokenExists[0]) throw new UnauthorizedException('Wrong token.');

    await this.db.drizzle
      .update(passwordResetTokensTable)
      .set({ used_at: new Date() })
      .where(eq(passwordResetTokensTable.id, tokenExists[0].id));

    const userId = tokenExists[0].user_id;
    await this.usersService.updatePassword(userId, newPassword);
    return { message: 'Password reset.' };
  }

  // mfa
  async setupMFA(userId: number, email: string) {
    const mfaActive = await this.usersService.hasMFAActive(userId);

    if (mfaActive) throw new BadRequestException('MFA already active!');

    const totp = new TOTP({
      issuer: 'Popcornly',
      label: email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: new TOTP().secret,
    });

    const uri = totp.toString();

    const qrDataUrl = await QRCode.toDataURL(uri);

    return {
      qrCode: qrDataUrl,
      secret: totp.secret.base32,
    };
  }

  async setupEmailMFA(userId: number) {
    const mfaActive = await this.usersService.hasMFAActive(userId);

    if (mfaActive) throw new BadRequestException('MFA already active!');

    const isEmailVerified = await this.usersService.isEmailVerified(userId);

    if (!isEmailVerified)
      throw new UnauthorizedException(
        'Email has to be verified in order to activate MFA!',
      );
    await this.usersService.activateEmailMFA(userId);
    return await this.generateMFABackupCodes(userId);
  }

  async verifyMFASetup(userId: number, code: string, secret: string) {
    const totp = new TOTP({
      issuer: 'Popcornly',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(secret),
    });

    const delta = totp.validate({ token: code, window: 1 });
    if (delta === null) throw new UnauthorizedException('Invalid code');
    await this.usersService.activateMFA(userId, secret);
    return await this.generateMFABackupCodes(userId);
  }

  async verifyMFALogin(tempToken: string, code: string, method: string) {
    const payload: { sub: number; type: string } =
      this.jwtService.verify(tempToken);
    if (payload.type !== 'mfa')
      throw new UnauthorizedException('Invalid token');

    const userId = payload.sub;
    const { mfa_active, totp_secret, mfa_default_method } =
      await this.usersService.getMfaData(userId);
    if (!mfa_active) throw new UnauthorizedException('MFA not configured');

    if (method === 'backup') {
      const isCodeValid = await this.verifyMFABackupCode(userId, code);
      if (!isCodeValid) throw new UnauthorizedException('Invalid backup code');
    } else {
      if (mfa_default_method === 'totp') {
        if (!totp_secret)
          throw new UnauthorizedException('Invalid totp_secret');

        const totp = new TOTP({
          issuer: 'Popcornly',
          algorithm: 'SHA1',
          digits: 6,
          period: 30,
          secret: Secret.fromBase32(totp_secret),
        });

        const delta = totp.validate({ token: code, window: 1 });
        if (delta === null) throw new UnauthorizedException('Invalid code');
      } else if (mfa_default_method === 'email') {
        const isCodeValid = await this.verifyEmailMfa(userId, code);
        if (!isCodeValid) throw new UnauthorizedException('Invalid code');
      } else {
        throw new UnauthorizedException('Unsupported MFA method');
      }
    }

    const user = await this.usersService.findOne(userId);
    return await this.generateTokens(user.id, user.email);
  }

  private async generateMFABackupCodes(userId: number) {
    const codes = Array.from({ length: 8 }, () => {
      const raw = crypto.randomBytes(4).toString('hex');
      return `${raw.slice(0, 4)}-${raw.slice(4)}`;
    });

    await this.db.drizzle
      .insert(mfaBackupCodesTable)
      .values(codes.map((code) => ({ user_id: userId, code })));

    return codes;
  }

  private async deleteAllMFABackupCodes(userId: number) {
    await this.db.drizzle
      .delete(mfaBackupCodesTable)
      .where(eq(mfaBackupCodesTable.user_id, userId));
  }

  async regenerateMFABackupCodes(userId: number) {
    const hasMFAActive = await this.usersService.hasMFAActive(userId);
    if (!hasMFAActive) throw new BadRequestException('MFA not configured');
    await this.deleteAllMFABackupCodes(userId);
    return await this.generateMFABackupCodes(userId);
  }

  async disableMFA(userId: number, password: string) {
    const userPasswordHash =
      await this.usersService.getUserPasswordHash(userId);

    const isValid = await bcrypt.compare(password, userPasswordHash);
    if (!isValid) throw new UnauthorizedException('Invalid password');

    await this.usersService.disableMFA(userId);
    await this.deleteAllMFABackupCodes(userId);
    await this.db.drizzle
      .delete(verificationCodesTable)
      .where(
        and(
          eq(verificationCodesTable.user_id, userId),
          eq(verificationCodesTable.type, 'mfa'),
        ),
      );
  }

  async loginOAuth(user: SafeUser) {
    return await this.generateTokens(user.id, user.email);
  }
}
