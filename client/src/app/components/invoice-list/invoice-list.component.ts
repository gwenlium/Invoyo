import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, timer, of } from 'rxjs';
import { switchMap, takeUntil, catchError } from 'rxjs/operators';
import { DocumentService } from '../../services/document.service';
import { DocumentItem } from '../../models/document.model';

@Component({
  selector: 'app-invoice-list',
  templateUrl: './invoice-list.component.html',
  styleUrls: ['./invoice-list.component.css'],
  standalone: true,
  imports: [CommonModule]
})
export class InvoiceListComponent implements OnInit, OnDestroy {
  documents = signal<DocumentItem[]>([]);
  loading = signal<boolean>(true);
  error = signal<string>('');
  lastUpdated = signal<Date | null>(null);

  private destroy$ = new Subject<void>();

  constructor(private documentService: DocumentService) {}

  ngOnInit(): void {
    // Poll the backend every 5s to mimic a "watcher" style live refresh.
    timer(0, 5000)
      .pipe(
        switchMap(() => this.documentService.list()),
        takeUntil(this.destroy$),
        catchError((err) => {
          this.error.set(err?.error?.detail || 'Could not load documents');
          this.loading.set(false);
          return of({ items: [], total: 0, skip: 0, limit: 0 });
        })
      )
      .subscribe((resp) => {
        this.documents.set(resp.items);
        this.loading.set(false);
        this.error.set('');
        this.lastUpdated.set(new Date());
      });
  }

  manualRefresh(): void {
    this.loading.set(true);
    this.documentService.list().subscribe({
      next: (resp) => {
        this.documents.set(resp.items);
        this.error.set('');
      },
      error: (err) => this.error.set(err?.error?.detail || 'Could not load documents'),
      complete: () => {
        this.loading.set(false);
        this.lastUpdated.set(new Date());
      },
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  statusClass(status: DocumentItem['status']): string {
    switch (status) {
      case 'processed':
        return 'status-ok';
      case 'processing':
        return 'status-processing';
      case 'pending':
        return 'status-pending';
      case 'failed':
      default:
        return 'status-failed';
    }
  }
}
