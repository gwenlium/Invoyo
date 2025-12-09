import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpEventType } from '@angular/common/http';
import { Subject } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { DocumentService } from '../../services/document.service';
import { DocumentItem } from '../../models/document.model';
import QRCode from 'qrcode';

type ColumnFilterKeys = 'filename' | 'state' | 'date' | 'amount' | 'status' | 'uploaded' | 'processed';

interface ToastMessage {
  id: number;
  message: string;
  background: string;
  color: string;
}

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
  
  // QR Code data URLs mapped by document ID
  qrCodeUrls = signal<Map<string, string>>(new Map());

  // Local overrides for processed_at to ensure Modified column updates immediately
  clientModified = signal<Map<string, string>>(new Map());

  // UI feedback toasts
  toasts = signal<ToastMessage[]>([]);

  private destroy$ = new Subject<void>();

  // Filter state
  activeTab = signal<'unpaid' | 'paid' | 'archived'>('unpaid');
  
  // Sorting state
  sortColumn = signal<string>('uploaded');
  sortDirection = signal<'asc' | 'desc'>('desc');

  private pollingTimer: any;
  private toastIdCounter = 0;
  private toastTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private audioContext?: AudioContext;

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
          const overrideMap = this.clientModified();
          const merged = resp.items.map(item => {
            const localTs = overrideMap.get(item.id);
            return localTs ? { ...item, processed_at: localTs } : item;
          });
          this.documents.set(merged);
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

  setTab(tab: 'unpaid' | 'paid' | 'archived'): void {
    this.activeTab.set(tab);
    this.manualRefresh();
  }

  fetchDocuments() {
    // Client-side filtering.
    return this.documentService.list(0, 100, undefined, this.searchQuery());
  }

  sortBy(column: string) {
    if (this.sortColumn() === column) {
      this.sortDirection.update(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set('asc');
    }
  }

  get filteredDocuments() {
    const tab = this.activeTab();
    const sortCol = this.sortColumn();
    const sortDir = this.sortDirection();
    
    let docs = this.documents().filter(doc => {
      // 1. Tab Filter
      if (tab === 'unpaid') {
        return ['pending', 'processing', 'processed', 'failed'].includes(doc.status);
      } else if (tab === 'paid') {
        return doc.status === 'paid';
      } else if (tab === 'archived') {
        return doc.status === 'archived';
      }
      return false;
    });

    // 2. Sorting
    return docs.sort((a, b) => {
      let valA: any = '';
      let valB: any = '';

      switch (sortCol) {
        case 'filename':
          valA = a.filename.toLowerCase();
          valB = b.filename.toLowerCase();
          break;
        case 'state':
          valA = a.status;
          valB = b.status;
          break;
        case 'date':
          // Parse DD.MM.YYYY or fallback
          valA = this.parseDate(this.deriveInvoiceDate(a));
          valB = this.parseDate(this.deriveInvoiceDate(b));
          break;
        case 'amount':
          // Parse amount string to number
          valA = this.parseAmount(this.deriveAmount(a));
          valB = this.parseAmount(this.deriveAmount(b));
          break;
        case 'status':
          valA = this.derivePaidStatus(a);
          valB = this.derivePaidStatus(b);
          break;
        case 'uploaded':
          valA = new Date(a.uploaded_at).getTime();
          valB = new Date(b.uploaded_at).getTime();
          break;
        case 'processed':
          valA = a.processed_at ? new Date(a.processed_at).getTime() : 0;
          valB = b.processed_at ? new Date(b.processed_at).getTime() : 0;
          break;
      }

      if (valA < valB) return sortDir === 'asc' ? -1 : 1;
      if (valA > valB) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }

  private parseDate(dateStr: string): number {
    if (!dateStr || dateStr === '—') return 0;
    // Expect DD.MM.YYYY
    const parts = dateStr.split('.');
    if (parts.length === 3) {
      return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0])).getTime();
    }
    return 0;
  }

  private parseAmount(amountStr: string): number {
    if (!amountStr || amountStr === '—') return 0;
    // Remove ' or other separators, replace , with . if needed
    // Swiss format often 1'234.50 or 1 234.50
    const clean = amountStr.replace(/'/g, '').replace(/ /g, '');
    return parseFloat(clean) || 0;
  }

  deleteDocument(doc: DocumentItem, event: Event) {
    event.stopPropagation();
    if (!confirm(`Are you sure you want to delete ${doc.filename}?`)) return;
    
    this.documentService.delete(doc.id).subscribe({
      next: () => {
        this.clientModified.update(map => {
          const next = new Map(map);
          next.delete(doc.id);
          return next;
        });
        this.documents.update(docs => docs.filter(d => d.id !== doc.id));
        this.triggerToast('Document deleted', { background: '#ef4444', color: '#ffffff', sound: 'error' });
      },
      error: () => this.triggerToast('Failed to delete document', { background: '#ef4444', color: '#ffffff', sound: 'error' })
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
          this.triggerToast('Document uploaded', { background: '#22c55e', color: '#ffffff', sound: 'success' });
        }
      },
      error: (err) => {
        this.error.set(err?.error?.detail || 'Upload failed');
        this.isUploading.set(false);
        this.triggerToast('Upload failed', { background: '#ef4444', color: '#ffffff', sound: 'error' });
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
      // Generate QR code when expanding row
      if (doc.qr_code_data && !this.qrCodeUrls().has(doc.id)) {
        this.generateQRCode(doc.id, doc.qr_code_data);
      }
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
      confirmed_amount: this.editForm().amount,
      processed_at: new Date().toISOString()
    };
    
    this.documentService.update(doc.id, updates).subscribe({
      next: (updatedDoc) => {
        const stamped = { ...updatedDoc, processed_at: updatedDoc.processed_at ?? new Date().toISOString() };
        // Update local state and stamp modified
        this.setClientModified(stamped.id, stamped);
        this.editingDocId.set(null);
        this.triggerToast('Invoice details saved', { background: '#22c55e', color: '#ffffff', sound: 'success' });
      },
      error: () => this.triggerToast('Failed to save invoice details', { background: '#ef4444', color: '#ffffff', sound: 'error' })
    });
  }

  markAsPaid(doc: DocumentItem, event?: Event): void {
    if (event) event.stopPropagation();
    this.documentService.update(doc.id, { 
      status: 'paid',
      processed_at: new Date().toISOString()
    }).subscribe({
      next: (updatedDoc) => {
        const stamped = { ...updatedDoc, processed_at: updatedDoc.processed_at ?? new Date().toISOString() };
        this.setClientModified(stamped.id, stamped);
        this.triggerToast('Marked as paid', { background: '#22c55e', color: '#ffffff', sound: 'success' });
      },
      error: () => this.triggerToast('Failed to mark as paid', { background: '#ef4444', color: '#ffffff', sound: 'error' })
    });
  }

  archiveDocument(doc: DocumentItem, event?: Event): void {
    if (event) event.stopPropagation();
    this.documentService.update(doc.id, { 
      status: 'archived',
      processed_at: new Date().toISOString()
    }).subscribe({
      next: (updatedDoc) => {
        const stamped = { ...updatedDoc, processed_at: updatedDoc.processed_at ?? new Date().toISOString() };
        this.setClientModified(stamped.id, stamped);
        this.triggerToast('Archived', { background: '#9ca3af', color: '#ffffffff', sound: 'info' });
      },
      error: () => this.triggerToast('Failed to archive document', { background: '#ef4444', color: '#ffffff', sound: 'error' })
    });
  }

  // Template expects `archive(doc, $event)`; provide a thin wrapper to match name.
  archive(doc: DocumentItem, event?: Event): void {
    this.archiveDocument(doc, event);
  }

  // Allow marking a document as unpaid (revert to processed/unpaid state).
  markAsUnpaid(doc: DocumentItem, event?: Event): void {
    if (event) event.stopPropagation();
    this.documentService.update(doc.id, { 
      status: 'processed',
      processed_at: new Date().toISOString()
    }).subscribe({
      next: (updatedDoc) => {
        const stamped = { ...updatedDoc, processed_at: updatedDoc.processed_at ?? new Date().toISOString() };
        this.setClientModified(stamped.id, stamped);
        this.triggerToast('Marked as unpaid', { background: '#f97316', color: '#ffffff', sound: 'info' });
      },
      error: () => this.triggerToast('Failed to mark as unpaid', { background: '#ef4444', color: '#ffffff', sound: 'error' })
    });
  }

  // Allow unarchiving a document (revert to paid state).
  unarchive(doc: DocumentItem, event?: Event): void {
    if (event) event.stopPropagation();
    this.documentService.update(doc.id, { 
      status: 'paid',
      processed_at: new Date().toISOString()
    }).subscribe({
      next: (updatedDoc) => {
        const stamped = { ...updatedDoc, processed_at: updatedDoc.processed_at ?? new Date().toISOString() };
        this.setClientModified(stamped.id, stamped);
        this.triggerToast('Unarchived', { background: '#9ca3af', color: '#111827', sound: 'info' });
      },
      error: () => this.triggerToast('Failed to unarchive', { background: '#ef4444', color: '#ffffff', sound: 'error' })
    });
  }

  private setClientModified(docId: string, updatedDoc: DocumentItem): void {
    const ts = updatedDoc.processed_at ?? new Date().toISOString();
    this.clientModified.update(map => {
      const next = new Map(map);
      next.set(docId, ts);
      return next;
    });
    this.documents.update(docs => docs.map(d => d.id === docId ? { ...updatedDoc, processed_at: ts } : d));
  }

  viewPdf(doc: DocumentItem, event?: Event): void {
    if (event) event.stopPropagation();
    if (doc.status !== 'processed') return;
    
    this.documentService.download(doc.id).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        window.open(url, '_blank');
      },
      error: () => this.triggerToast('Failed to open PDF', { background: '#ef4444', color: '#ffffff', sound: 'error' })
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
    }
    this.toastTimers.forEach(timeoutId => clearTimeout(timeoutId));
    this.toastTimers.clear();
    if (this.audioContext) {
      this.audioContext.close().catch(() => undefined);
    }
  }

  dismissToast(id: number, event?: Event): void {
    if (event) event.stopPropagation();
    this.removeToast(id);
  }

  statusClass(status: DocumentItem['status']): string {
    switch (status) {
      case 'paid':
        return 'status-paid';
      case 'archived':
        return 'status-archived';
      case 'processed':
        return 'status-modified';
      case 'processing':
        return 'status-processing';
      case 'pending':
        return 'status-pending';
      case 'failed':
      default:
        return 'status-failed';
    }
  }

  statusLabel(status: DocumentItem['status']): string {
    if (status === 'processed') return 'Modified';
    if (status === 'paid') return 'Paid';
    if (status === 'archived') return 'Archived';
    return status;
  }

  deriveInvoiceDate(doc: DocumentItem): string {
    let dateStr = doc.confirmed_due_date || doc.derived_due;
    
    if (!dateStr) {
      const text = doc.extracted_text || '';
      // Look for Rechnungsdatum, Datum, Date, or just a date pattern near keywords
      // Supports DD.MM.YYYY or YYYY-MM-DD
      const match = text.match(/(?:Rechnungsdatum|Datum|Date)\s*[:\-]?\s*((?:\d{1,2}[.\/\-]\d{1,2}[.\/\-]\d{2,4})|(?:\d{4}[.\/\-]\d{1,2}[.\/\-]\d{1,2}))/i);
      if (match) dateStr = match[1];
    }

    if (!dateStr) return '—';

    // Normalize to DD.MM.YYYY
    // Handle YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [y, m, d] = dateStr.split('-');
      return `${d}.${m}.${y}`;
    }
    // Handle YYYY.MM.DD
    if (/^\d{4}\.\d{2}\.\d{2}$/.test(dateStr)) {
      const [y, m, d] = dateStr.split('.');
      return `${d}.${m}.${y}`;
    }
    // Handle DD/MM/YYYY or DD-MM-YYYY -> DD.MM.YYYY
    if (/^\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}$/.test(dateStr)) {
      return dateStr.replace(/[/\-]/g, '.');
    }

    return dateStr;
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

  showUnpaidLabel(doc: DocumentItem): boolean {
    return doc.status === 'processed' && this.derivePaidStatus(doc) === 'Unpaid';
  }

  getQRCodeUrl(docId: string): string | undefined {
    return this.qrCodeUrls().get(docId);
  }

  private async generateQRCode(docId: string, data: string): Promise<void> {
    try {
      const dataUrl = await QRCode.toDataURL(data, {
        width: 200,
        margin: 2,
        errorCorrectionLevel: 'M'
      });
      this.qrCodeUrls.update(map => {
        const newMap = new Map(map);
        newMap.set(docId, dataUrl);
        return newMap;
      });
    } catch (err) {
      console.error('Failed to generate QR code:', err);
    }
  }

  private triggerToast(
    message: string,
    palette: { background?: string; color?: string; sound?: 'success' | 'info' | 'error' } = {}
  ): void {
    const id = ++this.toastIdCounter;
    const background = palette.background ?? '#2563eb';
    const color = palette.color ?? '#ffffff';
    this.toasts.update(list => [...list, { id, message, background, color }]);
    const timeoutId = setTimeout(() => this.removeToast(id), 3500);
    this.toastTimers.set(id, timeoutId);
    this.playToastSound(palette.sound ?? 'info');
  }

  private removeToast(id: number): void {
    const timeoutId = this.toastTimers.get(id);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.toastTimers.delete(id);
    }
    this.toasts.update(list => list.filter(toast => toast.id !== id));
  }

  private playToastSound(tone: 'success' | 'info' | 'error'): void {
    try {
      if (typeof window === 'undefined') return;
      const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return;
      if (!this.audioContext) {
        this.audioContext = new Ctor();
      }

      const ctx = this.audioContext;
      if (!ctx) return;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => undefined);
      }

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      const frequency = tone === 'success' ? 880 : tone === 'error' ? 220 : 660;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, ctx.currentTime);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.4);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    } catch (err) {
      console.warn('Toast sound could not be played', err);
    }
  }
}
