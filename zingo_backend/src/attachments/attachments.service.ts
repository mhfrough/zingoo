import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { Attachment } from './attachment.entity';

/** The biggest file accepted, in bytes. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** a file type the app accepts, with the first bytes every real file of that type starts with */
interface Kind {
  mime: string;
  extensions: string[];
  /** hex of the leading bytes (the "magic number") */
  magic: string[];
}

/**
 * Images, PDFs and Word documents. The type is checked three ways: the browser's type, the file extension and
 * the first bytes of the file, so a renamed program cannot pass as a picture.
 */
const KINDS: Kind[] = [
  { mime: 'image/png', extensions: ['png'], magic: ['89504e47'] },
  { mime: 'image/jpeg', extensions: ['jpg', 'jpeg'], magic: ['ffd8ff'] },
  { mime: 'image/gif', extensions: ['gif'], magic: ['47494638'] },
  { mime: 'image/webp', extensions: ['webp'], magic: ['52494646'] },
  { mime: 'application/pdf', extensions: ['pdf'], magic: ['25504446'] },
  { mime: 'application/msword', extensions: ['doc'], magic: ['d0cf11e0'] },
  {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extensions: ['docx'],
    magic: ['504b0304'],
  },
];

/** a file name with no path and no odd characters, never empty */
export function cleanFileName(raw: string): string {
  const base = raw.replace(/^.*[\\/]/, '').replace(/[^\w.\- ()]+/g, '_').trim().slice(0, 200);
  return base || 'file';
}

/** Stores, finds and removes uploaded files. */
@Injectable()
export class AttachmentsService {
  constructor(@InjectRepository(Attachment) private readonly repo: Repository<Attachment>) {}

  /** validate a file from an upload and keep it */
  async create(file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined, uploadedBy: string, owner?: { type?: string; id?: string }) {
    if (!file) throw new BadRequestException('Choose a file to attach.');
    if (file.size > MAX_ATTACHMENT_BYTES) throw new BadRequestException('The file is too large. Keep it under 5 MB.');
    if (file.size === 0) throw new BadRequestException('The file is empty.');
    const name = cleanFileName(file.originalname);
    const ext = (name.split('.').pop() ?? '').toLowerCase();
    const kind = KINDS.find((k) => k.mime === file.mimetype && k.extensions.includes(ext));
    if (!kind) throw new BadRequestException('Attach an image (PNG, JPEG, GIF, WebP), a PDF or a Word document.');
    const head = file.buffer.subarray(0, 4).toString('hex');
    if (!kind.magic.some((m) => head.startsWith(m))) throw new BadRequestException('The file does not look like a real ' + ext.toUpperCase() + ' file.');
    const saved = await this.repo.save(this.repo.create({
      name, mime: kind.mime, size: file.size, data: file.buffer,
      ownerType: owner?.type ?? null, ownerId: owner?.id ?? null, uploadedBy,
    }));
    return this.meta(saved);
  }

  /** the file's details, without its content */
  meta(a: Attachment) {
    return { id: a.id, name: a.name, mime: a.mime, size: a.size, ownerType: a.ownerType, ownerId: a.ownerId, uploadedBy: a.uploadedBy, createdAt: a.createdAt };
  }

  /** details for several files at once, by id */
  async metasOf(ids: string[]) {
    const map = new Map<string, ReturnType<AttachmentsService['meta']>>();
    if (!ids.length) return map;
    for (const a of await this.repo.find({ where: { id: In(ids) } })) map.set(a.id, this.meta(a));
    return map;
  }

  async metaOf(id: string) {
    const a = await this.repo.findOne({ where: { id } });
    if (!a) throw new NotFoundException('File not found.');
    return this.meta(a);
  }

  /** the file with its content, for a download */
  async content(id: string) {
    const a = await this.repo.createQueryBuilder('a').addSelect('a.data').where('a.id = :id', { id }).getOne();
    if (!a) throw new NotFoundException('File not found.');
    return a;
  }

  /** link a file to the record it belongs to (called by the form's service when the record is saved) */
  async attach(id: string, ownerType: string, ownerId: string, em?: EntityManager) {
    const repo = em ? em.getRepository(Attachment) : this.repo;
    const a = await repo.findOne({ where: { id } });
    if (!a) throw new BadRequestException('The attached file is missing. Attach it again.');
    if (a.ownerId && a.ownerId !== ownerId) throw new BadRequestException('This file is already attached to another record.');
    a.ownerType = ownerType;
    a.ownerId = ownerId;
    await repo.save(a);
  }

  async remove(id: string, by: { name: string; role: string }) {
    const a = await this.repo.findOne({ where: { id } });
    if (!a) throw new NotFoundException('File not found.');
    if (a.ownerId && by.role !== 'Admin') throw new BadRequestException('A file attached to a record can only be removed by an Admin.');
    await this.repo.remove(a);
    return { deleted: true };
  }
}
