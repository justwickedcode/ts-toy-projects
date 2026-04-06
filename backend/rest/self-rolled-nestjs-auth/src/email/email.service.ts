import { Resend } from 'resend';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EmailService {
  private readonly resend: Resend;
  private readonly fromEmail: string;

  constructor(private readonly config: ConfigService) {
    this.resend = new Resend(config.getOrThrow<string>('RESEND_API_KEY'));
    this.fromEmail = config.getOrThrow<string>('RESEND_EMAIL');
  }

  async sendVerificationCode(email: string, code: string) {
    await this.resend.emails.send({
      from: this.fromEmail,
      to: email,
      subject: 'Verification Code',
      html: `<strong>Verification Code: ${code}</strong>`,
    });
  }

  async sendPasswordResetLink(email: string, token: string) {
    const resetLink = `${this.config.getOrThrow<string>('FRONTEND_URL')}/reset-password?token=${token}`;
    await this.resend.emails.send({
      from: this.fromEmail,
      to: email,
      subject: 'Password Reset',
      html: `<p>Click <a href="${resetLink}">here</a> to reset your password. This link expires in 10 minutes.</p>`,
    });
  }

  async sendMfaCode(email: string, code: string) {
    await this.resend.emails.send({
      from: this.fromEmail,
      to: email,
      subject: 'Multi-Factor Authentication Code',
      html: `<strong>Multi-Factor Authentication Code: ${code}</strong>`,
    });
  }
}
