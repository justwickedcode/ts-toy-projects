import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Allow cookie parsing
  app.use(cookieParser());

  app.enableCors({
    origin: 'http://localhost:3000', // allow oauth callback
    credentials: true, // allows cookies to be sent cross-origin
  });

  await app.listen(process.env.PORT ?? 8080);
}

void bootstrap();
