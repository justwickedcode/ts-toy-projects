import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-github2';
import type { Profile } from 'passport-github2';
import { UsersService } from '../../users/users.service';
import { Providers } from '../enums/providers.enums';

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(
    private readonly config: ConfigService,
    private readonly userService: UsersService,
  ) {
    super({
      clientID: config.getOrThrow('GITHUB_CLIENT_ID'),
      clientSecret: config.getOrThrow('GITHUB_CLIENT_SECRET'),
      callbackURL: config.getOrThrow('GITHUB_CALLBACK_URL'),
      scope: ['user:email'],
    });
  }

  validate(accessToken: string, refreshToken: string, profile: Profile) {
    const email = profile.emails?.[0].value;
    if (!email)
      throw new UnauthorizedException('No email found on Google account');

    return this.userService.findOrCreateOAuthUser(
      {
        id: profile.id,
        username: profile.displayName, // Google doesn't have usernames, use displayName
        email,
      },
      Providers.GOOGLE,
    );
  }
}
