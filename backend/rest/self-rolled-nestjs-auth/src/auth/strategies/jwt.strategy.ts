import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '../types/jwt-payload.type';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly config: ConfigService) {
    super({
      jwtFromRequest: (req: Request): string | null => {
        const cookieToken =
          (req.cookies as Record<string, string>)?.token ?? null;
        return cookieToken ?? ExtractJwt.fromAuthHeaderAsBearerToken()(req);
      },
      secretOrKey: config.getOrThrow('JWT_SECRET'),
    });
  }

  validate(payload: JwtPayload) {
    return payload;
  }
}
