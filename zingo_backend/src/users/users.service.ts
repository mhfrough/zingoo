import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
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

  /** a user as the users screen sees it: never the password hash */
  private view(u: User) {
    const { password: _hash, ...rest } = u;
    return rest;
  }

  async list() {
    const rows = await this.repo.find({ relations: ['distributor', 'manufacturer'], order: { name: 'ASC' } });
    return rows.map((u) => ({
      ...this.view(u), distributorName: u.distributor?.name ?? null, manufacturerName: u.manufacturer?.name ?? null,
      distributor: undefined, manufacturer: undefined,
    }));
  }

  /** a login made from the users screen */
  async add(dto: { name: string; email: string; password: string; role: Role; seat?: Seat; distributorId?: string; manufacturerId?: string }) {
    const email = dto.email.trim().toLowerCase();
    if (await this.findByEmail(email)) throw new ConflictException('A user with this email already exists.');
    if (dto.role === 'Distributor' && !dto.distributorId) throw new BadRequestException('Choose which distributor this login belongs to.');
    if (dto.role === 'Manufacturer' && !dto.manufacturerId) throw new BadRequestException('Choose which manufacturer this login belongs to.');
    const u = await this.createUser({
      email, name: dto.name.trim(), password: dto.password, role: dto.role,
      seat: dto.role === 'Admin' || dto.role === 'Finance' ? dto.seat : 'None',
      distributorId: dto.role === 'Distributor' ? dto.distributorId : null,
      manufacturerId: dto.role === 'Manufacturer' ? dto.manufacturerId : null,
    });
    return this.view(u);
  }

  /**
   * Change a login. The root account keeps its role, seat and active status, nobody can switch off or demote
   * their own account here, and at least one active Admin always remains.
   */
  async edit(id: string, patch: { name?: string; role?: Role; seat?: Seat; status?: 'Active' | 'Disabled'; distributorId?: string | null; manufacturerId?: string | null }, actorId: string) {
    const u = await this.repo.findOne({ where: { id } });
    if (!u) throw new NotFoundException('User not found');
    const role = patch.role ?? u.role;
    const status = patch.status ?? u.status;
    const losesAdmin = u.role === 'Admin' && u.status === 'Active' && (role !== 'Admin' || status !== 'Active');
    if (u.isRoot && (role !== 'Admin' || status !== 'Active' || (patch.seat !== undefined && patch.seat !== 'Both'))) {
      throw new BadRequestException('The root account keeps the Admin role, seat Both and active status.');
    }
    if (id === actorId && (role !== u.role || status !== 'Active')) {
      throw new BadRequestException('You cannot switch off or demote your own account.');
    }
    if (losesAdmin && (await this.repo.count({ where: { role: 'Admin', status: 'Active' } })) <= 1) {
      throw new BadRequestException('At least one active Admin must remain.');
    }
    if (role === 'Distributor' && !(patch.distributorId ?? u.distributorId)) {
      throw new BadRequestException('Choose which distributor this login belongs to.');
    }
    if (role === 'Manufacturer' && !(patch.manufacturerId ?? u.manufacturerId)) {
      throw new BadRequestException('Choose which manufacturer this login belongs to.');
    }
    Object.assign(u, {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      role,
      status,
      seat: role === 'Admin' || role === 'Finance' ? (patch.seat ?? u.seat) : 'None',
      distributorId: role === 'Distributor' ? (patch.distributorId ?? u.distributorId) : null,
      manufacturerId: role === 'Manufacturer' ? (patch.manufacturerId ?? u.manufacturerId) : null,
    });
    return this.view(await this.repo.save(u));
  }

  async resetPassword(id: string, password: string) {
    const u = await this.repo.findOne({ where: { id } });
    if (!u) throw new NotFoundException('User not found');
    u.password = await bcrypt.hash(password, 10);
    await this.repo.save(u);
    return { reset: true };
  }

  async createUser(data: {
    email: string; name: string; password: string; role: Role; seat?: Seat; distributorId?: string | null; manufacturerId?: string | null;
  }) {
    const password = await bcrypt.hash(data.password, 10);
    return this.repo.save(
      this.repo.create({ ...data, email: data.email.toLowerCase(), password, seat: data.seat ?? 'None' }),
    );
  }
}
