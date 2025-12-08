import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpEventType } from '@angular/common/http';
import { Subject, timer, of } from 'rxjs';
import { switchMap, takeUntil, catchError, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { DocumentService } from '../../services/document.service';
import { DocumentItem } from '../../models/document.model';

@Component({
  selector: 'app-invoice-list',
  templateUrl: './invoice-list.component.html',
  styleUrls: ['./invoice-list.component.css'],
  standalone: true,
  imports: [CommonModule, FormsModule]
})
export class InvoiceListComponent implements OnInit, OnDestroy {
  documents = signal<DocumentItem[]>([]);
  expandedDocId = signal<string | null>(null);
  loading = signal<boolean>(true);
  error = signal<string>('');
  lastUpdated = signal<Date | null>(null);
  
  // Upload state
  uploadProgress = signal<number>(0);
  isUploading = signal<boolean>(false);
  uploadMessage = signal<string>('');
  
  searchQuery = signal<string>('');
  private searchSubject = new Subject<string>();
  
  editingDocId = signal<string | null>(null);
  editForm = signal<{ date: string; amount: string }>({ date: '', amount: '' });

  private destroy$ = new Subject<void>();

  // Filter state
  activeTab = signal<'active' | 'archive'>('active');

  private pollingTimer: any;

  constructor(private documentService: DocumentService) {}

  ngOnInit(): void {
    // Handle search debounce
    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(query => {
      this.searchQuery.set(query);
      this.manualRefresh();
    });

    // Start adaptive polling
    this.startPolling();
  }

  startPolling() {
    this.fetchDocuments().subscribe({
      next: (resp) => {
        if (!this.editingDocId()) {
          this.documents.set(resp.items);
          this.loading.set(false);
          this.error.set('');
          this.lastUpdated.set(new Date());
        }

        // Poll only if active work exists.
        const hasActiveWork = resp.items.some(d => ['pending', 'processing'].includes(d.status));
        
        if (hasActiveWork) {
          this.pollingTimer = setTimeout(() => this.startPolling(), 2000);
        } else {
          this.pollingTimer = null;
        }
      },
      error: (err) => {
        this.error.set(err?.error?.detail || 'Could not load documents');
        this.loading.set(false);
        this.pollingTimer = null;
      }
    });
  }

  setTab(tab: 'active' | 'archive'): void {
    this.activeTab.set(tab);
    this.manualRefresh();
  }

  fetchDocuments() {
    // Client-side filtering.
    return this.documentService.list(0, 100, undefined, this.searchQuery());
  }

  get filteredDocuments() {
    const tab = this.activeTab();
    return this.documents().filter(doc => {
      if (tab === 'active') {
        return ['pending', 'processing', 'processed', 'failed'].includes(doc.status);
      } else {
        return ['paid', 'archived'].includes(doc.status);
      }
    });
  }

  onSearch(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.searchSubject.next(input.value);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];
    this.upload(file);
    input.value = '';
  }

  upload(file: File): void {
    this.uploadProgress.set(0);
    this.uploadMessage.set('');
    this.isUploading.set(true);

    this.documentService.upload(file).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress && event.total) {
          const percent = Math.round((100 * event.loaded) / event.total);
          this.uploadProgress.set(percent);
        }
        if (event.type === HttpEventType.Response) {
          this.uploadMessage.set(`Uploaded: ${event.body?.filename}`);
          this.isUploading.set(false);
          
          // Force immediate refresh and reset polling to fast mode
          if (this.pollingTimer) clearTimeout(this.pollingTimer);
          this.startPolling();
          
          // Clear success message after 3s
          setTimeout(() => this.uploadMessage.set(''), 3000);
        }
      },
      error: (err) => {
        this.error.set(err?.error?.detail || 'Upload failed');
        this.isUploading.set(false);
      },
    });
  }

  manualRefresh(): void {
    this.loading.set(true);
    if (this.pollingTimer) clearTimeout(this.pollingTimer);
    this.startPolling();
  }

  toggleRow(doc: DocumentItem): void {
    if (this.editingDocId()) return; // Prevent toggling while editing
    if (this.expandedDocId() === doc.id) {
      this.expandedDocId.set(null);
    } else {
      this.expandedDocId.set(doc.id);
    }
  }

  startEdit(doc: DocumentItem, event: Event): void {
    event.stopPropagation();
    this.editingDocId.set(doc.id);
    this.editForm.set({
      date: this.deriveInvoiceDate(doc),
      amount: this.deriveAmount(doc)
    });
    // Ensure row is expanded
    this.expandedDocId.set(doc.id);
  }

  cancelEdit(event: Event): void {
    event.stopPropagation();
    this.editingDocId.set(null);
  }

  saveEdit(doc: DocumentItem, event: Event): void {
    event.stopPropagation();
    const updates = {
      confirmed_due_date: this.editForm().date,
      confirmed_amount: this.editForm().amount
    };
    
    this.documentService.update(doc.id, updates).subscribe({
      next: (updatedDoc) => {
        // Update local state
        this.documents.update(docs => docs.map(d => d.id === updatedDoc.id ? updatedDoc : d));
        this.editingDocId.set(null);
      },
      error: (err) => console.error('Failed to update document', err)
    });
  }

  markAsPaid(doc: DocumentItem, event: Event): void {
    event.stopPropagation();
    this.documentService.update(doc.id, { status: 'paid' }).subscribe({
      next: (updatedDoc) => {
        this.documents.update(docs => docs.map(d => d.id === updatedDoc.id ? updatedDoc : d));
      },
      error: (err) => console.error('Failed to mark as paid', err)
    });
  }

  viewPdf(doc: DocumentItem, event?: Event): void {
    if (event) event.stopPropagation();
    if (doc.status !== 'processed') return;
    
    this.documentService.download(doc.id).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        window.open(url, '_blank');
      },
      error: (err) => console.error('Failed to download document', err)
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
    }
  }

  statusClass(status: DocumentItem['status']): string {
    switch (status) {
      case 'paid':
        return 'status-ok'; // Re-use ok or create new class
      case 'archived':
        return 'status-ok';
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

  deriveInvoiceDate(doc: DocumentItem): string {
    if (doc.confirmed_due_date) return doc.confirmed_due_date; // Keeping the field name for now to avoid DB migration
    if (doc.derived_due) return doc.derived_due;
    const text = doc.extracted_text || '';
    // Look for Rechnungsdatum, Datum, Date, or just a date pattern near keywords
    // Supports DD.MM.YYYY or YYYY-MM-DD
    const match = text.match(/(?:Rechnungsdatum|Datum|Date)\s*[:\-]?\s*((?:\d{1,2}[.\/\-]\d{1,2}[.\/\-]\d{2,4})|(?:\d{4}[.\/\-]\d{1,2}[.\/\-]\d{1,2}))/i);
    return match ? match[1] : '—';
  }

  deriveAmount(doc: DocumentItem): string {
    if (doc.confirmed_amount) return doc.confirmed_amount;
    if (doc.derived_amount) return doc.derived_amount;
    const text = doc.extracted_text || '';
    const match = text.match(/(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})/);
    return match ? match[1] : '—';
  }

  derivePaidStatus(doc: DocumentItem): string {
    if (doc.status === 'paid' || doc.status === 'archived') return 'Paid';
    if (doc.derived_paid) return doc.derived_paid;
    const text = (doc.extracted_text || '').toLowerCase();
    if (text.includes('bezahlt') || text.includes('paid')) return 'Paid';
    if (doc.status === 'processed') return 'Unpaid';
    return 'Pending';
  }
}
