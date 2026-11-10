import { ConflictException, NotFoundException } from '@nestjs/common';
import { DeepPartial, FindOptionsWhere, Repository } from 'typeorm';
import { AppEntity } from './app.entity';

/** Turns the two common Postgres errors into clear HTTP errors. */
export function friendlyDbError(err: any): never {
  const code = err?.driverError?.code;
  if (code === '23505') throw new ConflictException('This value already exists. It must be unique.');
  if (code === '23503') throw new ConflictException('It is used by other records, so it cannot be removed. Mark it inactive instead.');
  throw err;
}

/** Plain list / get / create / update / delete used by master tables. */
export abstract class CrudService<E extends AppEntity> {
  protected relations: string[] = [];
  protected order: any = { createdAt: 'DESC' };

  constructor(protected readonly repo: Repository<E>) {}

  findAll(_query?: any): Promise<E[]> {
    return this.repo.find({ relations: this.relations, order: this.order });
  }

  async findOne(id: string): Promise<E> {
    const row = await this.repo.findOne({
      where: { id } as FindOptionsWhere<E>,
      relations: this.relations,
    });
    if (!row) throw new NotFoundException(`${this.repo.metadata.name} not found`);
    return row;
  }

  async create(dto: DeepPartial<E>): Promise<E> {
    try {
      return (await this.repo.save(this.repo.create(dto))) as E;
    } catch (err) {
      return friendlyDbError(err);
    }
  }

  async update(id: string, dto: DeepPartial<E>): Promise<E> {
    // load WITHOUT relations so a changed foreign key is not overridden by the old object
    const row = await this.repo.findOne({ where: { id } as FindOptionsWhere<E> });
    if (!row) throw new NotFoundException(`${this.repo.metadata.name} not found`);
    try {
      await this.repo.save(this.repo.merge(row, dto));
    } catch (err) {
      return friendlyDbError(err);
    }
    return this.findOne(id);
  }

  async remove(id: string) {
    const row = await this.findOne(id);
    try {
      await this.repo.remove(row);
    } catch (err) {
      return friendlyDbError(err);
    }
    return { deleted: true };
  }
}
