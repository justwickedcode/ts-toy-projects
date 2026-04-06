import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-google-oauth20';
import type { Profile } from 'passport-google-oauth20';
import { UsersService } from '../../users/users.service';
import { Providers } from '../enums/providers.enums';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      clientID: config.getOrThrow('GOOGLE_CLIENT_ID'),
      clientSecret: config.getOrThrow('GOOGLE_CLIENT_SECRET'),
      callbackURL: config.getOrThrow('GOOGLE_CALLBACK_URL'),
      scope: ['email', 'profile'],
    });
  }

  validate(accessToken: string, refreshToken: string, profile: Profile) {
    const email = profile.emails?.[0].value;
    if (!email)
      throw new UnauthorizedException('No email found on Google account');
    const googleUsername = email.split('@')[0];
    return this.usersService.findOrCreateOAuthUser(
      {
        id: profile.id,
        username: googleUsername,
        email,
      },
      Providers.GOOGLE,
    );
  }
}
