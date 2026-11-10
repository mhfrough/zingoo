import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { Role, Seat } from '../common/enums';
import { User } from './user.entity';

@Injectable()
export class UsersService implements OnApplicationBootstrap {
  private readonly log = new Logger('Users');

  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    private readonly config: ConfigService,
  ) {}

  /** Makes sure the root account from .env exists every time the API (or the seed) starts. */
  async onApplicationBootstrap() {
    await this.ensureRoot();
  }

  /**
   * Root = role Admin (the highest level) + signing seat "Both" + isRoot.
   * Created once from ROOT_EMAIL / ROOT_PASSWORD / ROOT_NAME. If it already exists nothing is changed,
   * so a password changed later in the app is never overwritten.
   */
  async ensureRoot() {
    const email = this.config.get<string>('ROOT_EMAIL')?.trim().toLowerCase();
    const password = this.config.get<string>('ROOT_PASSWORD');
    if (!email || !password) {
      this.log.warn('ROOT_EMAIL / ROOT_PASSWORD are not set in .env, so no root account was created.');
      return;
    }
    const existing = await this.repo.findOne({ where: { email } });
    if (existing) return;
    await this.repo.save(this.repo.create({
      email,
      name: this.config.get<string>('ROOT_NAME') || 'Root Admin',
      password: await bcrypt.hash(password, 10),
      role: 'Admin',
      seat: 'Both',
      status: 'Active',
      isRoot: true,
    }));
    this.log.log('Root account created.');
  }

  findByEmail(email: string) {
    return this.repo.findOne({ where: { email: email.toLowerCase() } });
  }

  findById(id: string) {
    return this.repo.findOne({ where: { id } });
  }

  async createUser(data: {
    email: string; name: string; password: string; role: Role; seat?: Seat; distributorId?: string | null;
  }) {
    const password = await bcrypt.hash(data.password, 10);
    return this.repo.save(
      this.repo.create({ ...data, email: data.email.toLowerCase(), password, seat: data.seat ?? 'None' }),
    );
  }
}
