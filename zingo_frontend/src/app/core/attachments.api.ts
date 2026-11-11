import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { saveBlob } from '../shared/files';

/** The details of an uploaded file (payment proof, agreement). The content is fetched on download. */
export interface AttachmentMeta {
  id: string;
  name: string;
  mime: string;
  size: number;
}

/** What the server accepts, shown to people and used to pre-filter the file picker. */
export const ATTACHMENT_ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.pdf,.doc,.docx';
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

/** Upload, download and remove files. Uploads are sent as a normal file upload (multipart), 5 MB at most. */
@Injectable({ providedIn: 'root' })
export class AttachmentsApi {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/attachments`;

  upload(file: File) {
    const body = new FormData();
    body.append('file', file, file.name);
    return this.http.post<AttachmentMeta>(this.base, body);
  }

  remove(id: string) {
    return this.http.delete(`${this.base}/${id}`);
  }

  /** fetches the file with the login token and saves it through the browser */
  download(file: Pick<AttachmentMeta, 'id' | 'name'>) {
    return this.http.get(`${this.base}/${file.id}`, { responseType: 'blob' }).pipe(tap((blob) => saveBlob(file.name, blob)));
  }
}
