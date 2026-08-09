import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // Global prefix for all routes
  app.setGlobalPrefix('api/v1');

  // Enable CORS
  app.enableCors({
    origin: configService.get<string>('CORS_ORIGIN', 'http://localhost:5173'),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  // Global validation pipe — auto-validates all incoming DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port);

  logger.log(`🚀 Ledgera API running on http://localhost:${port}/api/v1`);
  logger.log(`📋 Health check: http://localhost:${port}/api/v1/health`);
  logger.log(`🌍 Environment: ${configService.get<string>('NODE_ENV', 'development')}`);
}

bootstrap();
