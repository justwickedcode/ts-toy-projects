import { IsString, IsNotEmpty, Length, IsIn } from 'class-validator';

export class VerifyMfaSetupDto {
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  code!: string;

  @IsString()
  @IsNotEmpty()
  secret!: string;
}

export class VerifyMfaLoginDto {
  @IsString()
  @IsNotEmpty()
  tempToken!: string;

  @IsString()
  @IsNotEmpty()
  @Length(6, 20)
  code!: string;

  @IsString()
  @IsIn(['totp', 'email', 'backup'])
  method!: string;
}

export class DisableMfaDto {
  @IsString()
  @IsNotEmpty()
  password!: string;
}
