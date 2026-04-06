import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbService } from '../db/db.service';
import { verificationCodesTable } from '../db/schemas/verification_codes.schema';
import { passwordResetTokensTable } from '../db/schemas/password_reset_tokens.schema';
import { refreshTokensTable } from '../db/schemas/refresh_tokens.schema';
import { lt, or, isNotNull } from 'drizzle-orm';

@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(private readonly db: DbService) {}

  // clean up expired codes every hour
  @Cron('0 * * * *')
  async handleExpiredCodes() {
    // clean up verification codes
    await this.db.drizzle
      .delete(verificationCodesTable)
      .where(lt(verificationCodesTable.expires_at, new Date()));

    await this.db.drizzle
      .delete(passwordResetTokensTable)
      .where(lt(passwordResetTokensTable.expires_at, new Date()));

    await this.db.drizzle
      .delete(refreshTokensTable)
      .where(
        or(
          lt(refreshTokensTable.expires_at, new Date()),
          isNotNull(refreshTokensTable.used_at),
        ),
      );

    this.logger.log('Expired codes and tokens cleaned up');
  }
}
