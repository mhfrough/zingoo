import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');

  const origins = config
    .get<string>('CORS_ORIGIN', 'http://localhost:4270')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''));
  app.enableCors({ origin: origins.includes('*') ? true : origins, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const swagger = new DocumentBuilder()
    .setTitle('Zingo - Distributor Portal API')
    .setDescription('Financial ledger for the chips business: manufacturers, distributors, stock, money.')
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'JWT')
    .addSecurityRequirements('JWT')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger), {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = config.get<number>('PORT', 3020);
  await app.listen(port);
  console.log(`API:     http://localhost:${port}/api`);
  console.log(`Swagger: http://localhost:${port}/api/docs`);
}

bootstrap();
