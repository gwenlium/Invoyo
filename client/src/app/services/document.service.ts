import { Injectable } from '@angular/core';
import { HttpClient, HttpParams, HttpEvent } from '@angular/common/http';
import { Observable, EMPTY, from, throwError } from 'rxjs';
import { concatMap, map, catchError } from 'rxjs/operators';
import { DocumentItem, DocumentListResponse } from '../models/document.model';

@Injectable({ providedIn: 'root' })
export class DocumentService {
  private baseUrl = '/api/documents';

  constructor(private http: HttpClient) {}

  list(skip = 0, limit = 20, statusFilter?: string, searchQuery?: string): Observable<DocumentListResponse> {
    let params = new HttpParams().set('skip', skip).set('limit', limit);
    if (statusFilter) params = params.set('status_filter', statusFilter);
    if (searchQuery) params = params.set('search_query', searchQuery);
    return this.http.get<DocumentListResponse>(`${this.baseUrl}/`, { params });
  }

  get(documentId: string): Observable<DocumentItem> {
    return this.http.get<DocumentItem>(`${this.baseUrl}/${documentId}`);
  }

  update(documentId: string, updates: Partial<DocumentItem>): Observable<DocumentItem> {
    return this.http.patch<DocumentItem>(`${this.baseUrl}/${documentId}`, updates);
  }

  upload(file: File): Observable<HttpEvent<DocumentItem>> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<DocumentItem>(`${this.baseUrl}/`, form, {
      reportProgress: true,
      observe: 'events',
    });
  }

  uploadBatch(files: File[]): Observable<{ event: HttpEvent<DocumentItem>; file: File; index: number; total: number }> {
    if (!files.length) {
      return EMPTY;
    }

    const total = files.length;
    return from(files).pipe(
      concatMap((file, index) =>
        this.upload(file).pipe(
          map(event => ({ event, file, index, total })),
          catchError(err => {
            (err as any).uploadContext = { file, index, total };
            return throwError(() => err);
          })
        )
      )
    );
  }

  download(documentId: string): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/${documentId}/download`, {
      responseType: 'blob',
    });
  }

  delete(documentId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${documentId}`);
  }
}
