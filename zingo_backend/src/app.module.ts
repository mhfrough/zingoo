import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttachmentsModule } from './attachments/attachments.module';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { DistributionModule } from './distribution/distribution.module';
import { ExportsModule } from './exports/exports.module';
import { FinanceModule } from './finance/finance.module';
import { LedgerModule } from './ledger/ledger.module';
import { ManufacturingModule } from './manufacturing/manufacturing.module';
import { PortalModule } from './portal/portal.module';
import { ReportsModule } from './reports/reports.module';
import { SetupModule } from './setup/setup.module';
import { CompaniesModule } from './companies/companies.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === 'production' ? '.env.production' : '.env',
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.get<string>('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get<string>('DB_USERNAME', 'postgres'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_DATABASE', 'zingo_db'),
        autoLoadEntities: true,
        synchronize: config.get('DB_SYNC', 'false') === 'true', // dev only; use migrations in production
        logging: config.get('DB_LOGGING', 'false') === 'true',
        ssl: config.get('DB_SSL', 'false') === 'true' ? { rejectUnauthorized: false } : false,
      }),
    }),

    // login, users, roles
    AuthModule,
    UsersModule,

    // setup: settings, currencies, chart of accounts, cost centers
    SetupModule,
    CompaniesModule,

    // masters
    CatalogModule,

    // operations
    ManufacturingModule,
    DistributionModule,

    // money
    FinanceModule,
    LedgerModule,

    // later phases (tables exist, endpoints come with the pages)
    ExportsModule,
    PortalModule,
    AttachmentsModule,

    // reports
    ReportsModule,
  ],
})
export class AppModule {}
