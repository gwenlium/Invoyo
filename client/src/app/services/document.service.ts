import { Injectable } from '@angular/core';
import { HttpClient, HttpParams, HttpEvent } from '@angular/common/http';
import { Observable } from 'rxjs';
import { DocumentItem, DocumentListResponse } from '../models/document.model';

@Injectable({ providedIn: 'root' })
export class DocumentService {
  private baseUrl = '/api/documents';

  constructor(private http: HttpClient) {}

  list(skip = 0, limit = 20, statusFilter?: string): Observable<DocumentListResponse> {
    let params = new HttpParams().set('skip', skip).set('limit', limit);
    if (statusFilter) params = params.set('status_filter', statusFilter);
    return this.http.get<DocumentListResponse>(`${this.baseUrl}/`, { params });
  }

  get(documentId: string): Observable<DocumentItem> {
    return this.http.get<DocumentItem>(`${this.baseUrl}/${documentId}`);
  }

  upload(file: File): Observable<HttpEvent<DocumentItem>> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<DocumentItem>(`${this.baseUrl}/`, form, {
      reportProgress: true,
      observe: 'events',
    });
  }
}
