import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Invoice, InvoiceListResponse } from '../models/invoice.model';
import { InvoiceView } from '../models/invoice-view.model';

@Injectable({
  providedIn: 'root'
})
export class InvoiceService {
  private apiUrl = '/api/documents/'; // Using proxy to avoid CORS

  constructor(private http: HttpClient) { }

  getInvoices(): Observable<InvoiceView[]> {
    return this.http.get<InvoiceListResponse>(this.apiUrl).pipe(
      map(response => {
        // Map backend DocumentResponse to frontend InvoiceView model
        return response.items.map((item: Invoice): InvoiceView => {
          let status: InvoiceView['status'];
          switch (item.status) {
            case 'processed':
              status = 'Paid';
              break;
            case 'pending':
              status = 'Pending';
              break;
            case 'failed':
              status = 'Failed';
              break;
            case 'processing':
              status = 'Processing';
              break;
            default:
              status = 'Pending';
          }
          return {
            id: item.id,
            vendor_name: item.filename.split('.')[0],
            amount: Math.random() * 1000, // Placeholder
            due_date: item.uploaded_at,
            status: status
          };
        });
      })
    );
  }
}
