import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpEventType } from '@angular/common/http';
import { Subject, Subscription } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { DocumentService } from '../../services/document.service';
import { DocumentItem } from '../../models/document.model';
import QRCode from 'qrcode';

type ColumnFilterKeys = 'filename' | 'state' | 'date' | 'amount' | 'status' | 'uploaded' | 'processed';
type TabKey = 'all' | 'unpaid' | 'paid' | 'archived';

interface ToastMessage {
  id: number;
  message: string;
  background: string;
  color: string;
  leaving?: boolean;
}

interface FormattedExtractedLine {
  index: number;
  text: string;
  classList: string[];
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
  editForm = signal<{ filename: string; date: string; amount: string }>({ filename: '', date: '', amount: '' });
  
  // QR Code data URLs mapped by document ID
  qrCodeUrls = signal<Map<string, string>>(new Map());
  
  clientModified = signal<Map<string, string>>(new Map());

  // UI feedback toasts
  toasts = signal<ToastMessage[]>([]);
  
  // Delete confirmation - track which document is awaiting confirmation
  deleteConfirmId = signal<string | null>(null);
  
  // Track which file is being opened for animation
  openingFileId = signal<string | null>(null);
  
  // Track which row just expanded for one-time animation
  justExpandedDocId = signal<string | null>(null);
  
  // Track initial page load for animation (signal for template binding)
  hasInitiallyLoaded = signal<boolean>(false);
  // Private flag to track if animation has ever been shown
  private animationHasPlayed = false;

  private readonly dueKeywords = [
    'due date',
    'due-date',
    'payment due',
    'payment deadline',
    'due on',
    'fällig',
    'faellig',
    'zahlbar',
    'zahlungsziel',
    'verfall',
    'scadenza',
    'scad.',
    'vencimiento',
    'vence',
    'deadline'
  ];

  private readonly amountKeywords = [
    'total',
    'amount',
    'betrag',
    'summe',
    'balance',
    'due',
    'payable',
    'zahlbetrag',
    'grand total',
    'invoice total',
    'totalbetrag',
    'rechnungsbetrag',
    'gesamtbetrag',
    'zu zahlen',
    'amount due',
    'total due',
    'net total',
    'brutto',
    'netto',
    'montant',
    'importo',
    'solde'
  ];

  private readonly supportedCurrencies = new Set([
    'CHF','EUR','USD','GBP','SEK','NOK','DKK','CAD','AUD','NZD','JPY','CNY','INR'
  ]);

  private readonly monthLookup: Record<string, number> = {
    jan: 1,
    januar: 1,
    january: 1,
    feb: 2,
    februar: 2,
    february: 2,
    mar: 3,
    maerz: 3,
    marz: 3,
    march: 3,
    apr: 4,
    april: 4,
    mai: 5,
    may: 5,
    jun: 6,
    juni: 6,
    june: 6,
    juli: 7,
    july: 7,
    jul: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    oktober: 10,
    october: 10,
    octobre: 10,
    okt: 10,
    nov: 11,
    november: 11,
    dez: 12,
    dezember: 12,
    december: 12
  };

  private destroy$ = new Subject<void>();

  // Filter state
  activeTab = signal<TabKey>('all');
  readonly tabLabels: Record<TabKey, string> = {
    all: 'All',
    unpaid: 'Unpaid',
    paid: 'Paid',
    archived: 'Archived'
  };
  
  // Sorting state
  sortColumn = signal<string>('uploaded');
  sortDirection = signal<'asc' | 'desc'>('desc');

  private pollingTimer: any;
  private toastIdCounter = 0;
  private toastTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private audioContext?: AudioContext;
  private formattedTextCache = new Map<string, { source: string; lines: FormattedExtractedLine[] }>();
  private uploadSubscription?: Subscription;

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
          this.formattedTextCache.clear();
          this.loading.set(false);
          this.error.set('');
          this.lastUpdated.set(new Date());
          
          // Show animation only once on initial page load
          if (!this.animationHasPlayed && merged.length > 0) {
            this.animationHasPlayed = true;
            this.hasInitiallyLoaded.set(true);
            // Remove the animation class after all animations complete (quite important lol)
            setTimeout(() => this.hasInitiallyLoaded.set(false), 1500);
          }
        }

        // Poll if active work exists (pending/processing) or if we have saved docs that might be getting processed
        const hasActiveWork = resp.items.some(d => 
          ['pending', 'processing'].includes(d.status) || 
          (d.status === 'saved' && (!d.extracted_text || d.extracted_text.trim().length === 0))
        );
        
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

  formattedExtractedText(doc: DocumentItem): FormattedExtractedLine[] {
    const text = doc.extracted_text ?? '';
    const cached = this.formattedTextCache.get(doc.id);
    if (cached && cached.source === text) {
      return cached.lines;
    }

    const lines = this.buildFormattedLines(text);
    this.formattedTextCache.set(doc.id, { source: text, lines });
    return lines;
  }

  trackFormattedLine(_index: number, line: FormattedExtractedLine): number {
    return line.index;
  }

  async copyExtractedText(doc: DocumentItem, event?: Event): Promise<void> {
    if (event) event.stopPropagation();
    const text = doc.extracted_text;
    if (!text) return;

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      this.triggerToast('Extracted text copied', { background: '#2563eb', color: '#ffffff', sound: 'info' });
    } catch (err) {
      console.error('Failed to copy extracted text:', err);
      this.triggerToast('Could not copy text', { background: '#ef4444', color: '#ffffff', sound: 'error' });
    }
  }

  setTab(tab: TabKey): void {
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
    
    let docs = this.documents();

    if (tab !== 'all') {
      docs = docs.filter(doc => {
        if (tab === 'unpaid') {
          return ['pending', 'processing', 'processed', 'failed'].includes(doc.status);
        }
        if (tab === 'paid') {
          return doc.status === 'paid';
        }
        if (tab === 'archived') {
          return doc.status === 'archived';
        }
        return true;
      });
    }

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

  getFileType(filename: string): string {
    const ext = filename.split('.').pop()?.toUpperCase() || 'Unknown';
    return ext;
  }

  initiateDelete(doc: DocumentItem, event: Event) {
    event.stopPropagation();
    this.deleteConfirmId.set(doc.id);
  }

  confirmDelete(event: Event) {
    event.stopPropagation();
    const docId = this.deleteConfirmId();
    if (!docId) return;
    
    const doc = this.documents().find(d => d.id === docId);
    if (!doc) return;
    
    this.documentService.delete(doc.id).subscribe({
      next: () => {
        this.clientModified.update(map => {
          const next = new Map(map);
          next.delete(doc.id);
          return next;
        });
        this.documents.update(docs => docs.filter(d => d.id !== doc.id));
        this.triggerToast('File deleted', { background: '#ef4444', color: '#ffffff', sound: 'error' });
        this.cancelDelete(event);
      },
      error: () => {
        this.triggerToast('Failed to delete document', { background: '#ef4444', color: '#ffffff', sound: 'error' });
        this.cancelDelete(event);
      }
    });
  }

  cancelDelete(event: Event) {
    event.stopPropagation();
    this.deleteConfirmId.set(null);
  }

  onSearch(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.searchSubject.next(input.value);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    this.uploadFiles(Array.from(input.files));
    input.value = '';
  }

  uploadFiles(files: File[]): void {
    if (!files.length) return;

    this.uploadSubscription?.unsubscribe();
    this.uploadProgress.set(0);
    this.uploadMessage.set('');
    this.isUploading.set(true);

    const total = files.length;
    let completed = 0;

    this.uploadSubscription = this.documentService.uploadBatch(files).subscribe({
      next: ({ event, file, index }) => {
        if (event.type === HttpEventType.UploadProgress) {
          const filePortion = event.total ? event.loaded / event.total : 0;
          const aggregate = ((completed + filePortion) / total) * 100;
          this.uploadProgress.set(Math.round(aggregate));
          this.uploadMessage.set(`Uploading ${index + 1}/${total}: ${file.name}`);
        }

        if (event.type === HttpEventType.Response) {
          completed += 1;
          this.uploadProgress.set(Math.round((completed / total) * 100));
          this.uploadMessage.set(`Uploaded ${completed}/${total}`);

          if (this.pollingTimer) clearTimeout(this.pollingTimer);
          this.startPolling();

          this.triggerToast(`File uploaded: ${event.body?.filename || file.name}`, {
            background: '#22c55e',
            color: '#ffffff',
            sound: 'success'
          });

          if (completed === total) {
            setTimeout(() => this.uploadMessage.set(''), 3000);
          }
        }
      },
      error: (err) => {
        const context = err?.uploadContext;
        const fileName = context?.file?.name ?? 'file';
        this.error.set(err?.error?.detail || `Upload failed for ${fileName}`);
        this.isUploading.set(false);
        this.uploadProgress.set(0);
        this.uploadMessage.set('');
        this.triggerToast('Upload failed', { background: '#ef4444', color: '#ffffff', sound: 'error' });
      },
      complete: () => {
        this.isUploading.set(false);
      }
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
      this.justExpandedDocId.set(null);
    } else {
      this.expandedDocId.set(doc.id);
      // Set animation flag and clear it after animation completes
      this.justExpandedDocId.set(doc.id);
      setTimeout(() => this.justExpandedDocId.set(null), 500);
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
      filename: doc.filename,
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
      filename: this.editForm().filename,
      confirmed_due_date: this.editForm().date,
      confirmed_amount: this.editForm().amount,
      processed_at: this.formatLocalDateTime(new Date())
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
    this.justExpandedDocId.set(null); // Prevent animation on status change
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
    this.justExpandedDocId.set(null); // Prevent animation on status change
    this.documentService.update(doc.id, { 
      status: 'archived',
      processed_at: new Date().toISOString()
    }).subscribe({
      next: (updatedDoc) => {
        const stamped = { ...updatedDoc, processed_at: updatedDoc.processed_at ?? new Date().toISOString() };
        this.setClientModified(stamped.id, stamped);
        this.triggerToast('Archived', { background: '#3b82f6', color: '#ffffff', sound: 'info' });
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
    this.justExpandedDocId.set(null); // Prevent animation on status change
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
    this.justExpandedDocId.set(null); // Prevent animation on status change
    this.documentService.update(doc.id, { 
      status: 'paid',
      processed_at: new Date().toISOString()
    }).subscribe({
      next: (updatedDoc) => {
        const stamped = { ...updatedDoc, processed_at: updatedDoc.processed_at ?? new Date().toISOString() };
        this.setClientModified(stamped.id, stamped);
        this.triggerToast('Unarchived', { background: '#3b82f6', color: '#ffffff', sound: 'info' });
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

  viewFile(doc: DocumentItem, event?: Event): void {
    if (event) event.stopPropagation();
    
    // Trigger opening animation
    this.openingFileId.set(doc.id);
    
    this.documentService.download(doc.id).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        window.open(url, '_blank');
        // Remove animation after file opens
        setTimeout(() => this.openingFileId.set(null), 600);
      },
      error: () => {
        this.openingFileId.set(null);
        this.triggerToast('Failed to open file', { background: '#ef4444', color: '#ffffff', sound: 'error' });
      }
    });
  }

  // Alias for backward compatibility
  viewPdf(doc: DocumentItem, event?: Event): void {
    this.viewFile(doc, event);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
    }
    this.uploadSubscription?.unsubscribe();
    this.toastTimers.forEach(timeoutId => clearTimeout(timeoutId));
    this.toastTimers.clear();
    if (this.audioContext) {
      this.audioContext.close().catch(() => undefined);
    }
    this.toasts.set([]);
  }

  dismissToast(id: number, event?: Event): void {
    if (event) event.stopPropagation();
    this.startToastExit(id);
  }

  statusClass(status: DocumentItem['status']): string {
    switch (status) {
      case 'paid':
        return 'status-paid';
      case 'archived':
        return 'status-archived';
      case 'saved':
        return 'status-saved';
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
    if (status === 'saved') return 'Saved';
    if (status === 'processed') return 'Modified';
    if (status === 'paid') return 'Paid';
    if (status === 'archived') return 'Archived';
    return status;
  }

  formatLocalDateTime(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${ms}`;
  }

  formatTimestamp(timestamp: string | Date): string {
    if (!timestamp) return '—';
    
    // Convert to Date object and format in local timezone
    const date = new Date(timestamp);
    
    // Check if date is valid
    if (isNaN(date.getTime())) return '—';
    
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    
    return `${day}.${month}.${year} ${hours}:${minutes}`;
  }

  deriveInvoiceDate(doc: DocumentItem): string {
    const confirmed = this.normalizeDate(doc.confirmed_due_date);
    if (confirmed) return confirmed;

    const derived = this.normalizeDate(doc.derived_due);
    if (derived) return derived;

    const text = doc.extracted_text || '';
    if (!text) return '—';

    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const fallbackDates: string[] = [];

    for (const line of lines) {
      const normalized = this.stripDiacritics(line).toLowerCase();
      const candidate = this.findDateInLine(line);
      if (!candidate) continue;

      if (this.dueKeywords.some(keyword => normalized.includes(keyword))) {
        return candidate;
      }

      fallbackDates.push(candidate);
    }

    return fallbackDates.length ? fallbackDates[0] : '—';
  }

  deriveAmount(doc: DocumentItem): string {
    if (doc.confirmed_amount) return doc.confirmed_amount;
    if (doc.derived_amount) return doc.derived_amount;

    const text = doc.extracted_text || '';
    if (!text) return '—';

    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const candidates: Array<{ value: number; currency?: string; weight: number; confidence: number }> = [];

    // Priority 1: Search for lines with strong amount keywords (and next line if amount not on same line)
    const strongKeywords = ['total', 'montant', 'betrag', 'amount due', 'due', 'rechnungsbetrag'];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const normalized = this.stripDiacritics(line).toLowerCase();
      const hasStrongKeyword = strongKeywords.some(kw => normalized.includes(kw));
      if (!hasStrongKeyword) continue;

      // Check amount on same line first
      let matches = this.extractAmountsFromLine(line);
      if (matches.length > 0) {
        for (const match of matches) {
          if (match.value >= 10 && match.value <= 999999) {
            const weight = 100 + (match.currency ? 10 : 0) + Math.min(match.value / 100000, 5);
            candidates.push({ value: match.value, currency: match.currency, weight, confidence: 0.95 });
          }
        }
      }

      // If no amount on same line, check next line
      if (matches.length === 0 && i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        matches = this.extractAmountsFromLine(nextLine);
        for (const match of matches) {
          if (match.value >= 10 && match.value <= 999999) {
            // Very high weight for amount right after keyword (even higher than same line)
            const weight = 110 + (match.currency ? 10 : 0) + Math.min(match.value / 100000, 5);
            candidates.push({ value: match.value, currency: match.currency, weight, confidence: 0.95 });
          }
        }
      }
    }

    // Priority 2: Search for lines with general amount keywords
    if (candidates.length === 0) {
      for (const line of lines) {
        if (!line) continue;
        const normalized = this.stripDiacritics(line).toLowerCase();
        const hasKeyword = this.amountKeywords.some(keyword => normalized.includes(keyword));
        if (!hasKeyword) continue;

        const matches = this.extractAmountsFromLine(line);
        for (const match of matches) {
          if (match.value >= 10 && match.value <= 999999) {
            const weight = 50 + (match.currency ? 10 : 0) + Math.min(match.value / 100000, 3);
            candidates.push({ value: match.value, currency: match.currency, weight, confidence: 0.80 });
          }
        }
      }
    }

    // Priority 3: Search for amounts with currency (even without keywords)
    if (candidates.length === 0) {
      for (const line of lines) {
        if (!line) continue;
        const hasCurrency = /(CHF|EUR|USD|GBP|SEK|NOK|DKK|CAD|AUD|NZD|JPY|CNY|INR|€|\$|£)/i.test(line);
        if (!hasCurrency) continue;

        const matches = this.extractAmountsFromLine(line);
        for (const match of matches) {
          if (match.value >= 10 && match.value <= 999999) {
            const weight = 30 + (match.currency ? 5 : 0) + Math.min(match.value / 100000, 2);
            candidates.push({ value: match.value, currency: match.currency, weight, confidence: 0.65 });
          }
        }
      }
    }

    // Fallback: Last larger amount in the document
    if (candidates.length === 0) {
      const allMatches = this.extractAmountsFromLine(text);
      const largeAmounts = allMatches.filter(m => m.value >= 50 && m.value <= 999999);
      if (largeAmounts.length > 0) {
        // Pick the last (latest) large amount
        const last = largeAmounts[largeAmounts.length - 1];
        candidates.push({ value: last.value, currency: last.currency, weight: 5, confidence: 0.40 });
      }
    }

    if (!candidates.length) {
      return '—';
    }

    candidates.sort((a, b) => b.weight - a.weight || b.value - a.value);
    const best = candidates[0];
    return this.formatAmountValue(best.value, best.currency);
  }

  derivePaidStatus(doc: DocumentItem): string {
    if (doc.status === 'paid' || doc.status === 'archived') return 'Paid';
    if (doc.derived_paid) return doc.derived_paid;
    const text = (doc.extracted_text || '').toLowerCase();
    if (text.includes('bezahlt') || text.includes('paid')) return 'Paid';
    // For processed or saved documents, default to unpaid
    if (doc.status === 'processed' || doc.status === 'saved') return 'Unpaid';
    // For any document with extracted text or derived_amount, default to unpaid if not marked paid
    if (doc.extracted_text || doc.derived_amount) return 'Unpaid';
    return 'Pending';
  }

  hasExtractedData(doc: DocumentItem): boolean {
    return !!(doc.extracted_text && doc.extracted_text.trim().length > 0);
  }

  showUnpaidLabel(doc: DocumentItem): boolean {
    // Show Unpaid label only for documents that are NOT paid and NOT archived
    // and have extracted data (processed or saved with data)
    if (doc.status === 'paid' || doc.status === 'archived') {
      return false;
    }
    // Show for processed status, or saved status with extracted data
    return doc.status === 'processed' || (doc.status === 'saved' && this.hasExtractedData(doc));
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

  private findDateInLine(line: string): string | null {
    if (!line) return null;
    const fragments = [
      /\d{4}-\d{2}-\d{2}/g,
      /\d{4}[.\/]\d{1,2}[.\/]\d{1,2}/g,
      /\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}/g,
      /\d{1,2}\.\s*[A-Za-zÄÖÜäöüß.]+\s*\d{2,4}/g,
      /[A-Za-zÄÖÜäöüß.]+\s+\d{1,2}(?:\s*,)?\s*\d{2,4}/g
    ];

    for (const pattern of fragments) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(line)) !== null) {
        const normalized = this.normalizeDate(match[0]);
        if (normalized) {
          return normalized;
        }
      }
    }

    return null;
  }

  private normalizeDate(input?: string | null): string | null {
    if (!input) return null;
    let candidate = input.trim();
    if (!candidate) return null;

    const isoDateTime = candidate.match(/^(\d{4}-\d{2}-\d{2})[T\s]/);
    if (isoDateTime) {
      candidate = isoDateTime[1];
    }

    candidate = candidate.replace(/\s+/g, ' ');

    let parts = candidate.match(/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})$/);
    if (parts) {
      return this.formatDateParts(
        parseInt(parts[3], 10),
        parseInt(parts[2], 10),
        parseInt(parts[1], 10)
      );
    }

    parts = candidate.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/);
    if (parts) {
      return this.formatDateParts(
        parseInt(parts[1], 10),
        parseInt(parts[2], 10),
        parseInt(parts[3], 10)
      );
    }

    parts = this.stripDiacritics(candidate).match(/^(\d{1,2})\.?\s*([A-Za-z]+)\s+(\d{2,4})$/);
    if (parts) {
      const month = this.monthFromName(parts[2]);
      if (month) {
        return this.formatDateParts(
          parseInt(parts[1], 10),
          month,
          parseInt(parts[3], 10)
        );
      }
    }

    parts = this.stripDiacritics(candidate).match(/^([A-Za-z]+)\s+(\d{1,2})(?:\s*,)?\s*(\d{2,4})$/);
    if (parts) {
      const month = this.monthFromName(parts[1]);
      if (month) {
        return this.formatDateParts(
          parseInt(parts[2], 10),
          month,
          parseInt(parts[3], 10)
        );
      }
    }

    return null;
  }

  private formatDateParts(day: number, month: number, year: number): string | null {
    if (!day || !month || !year) return null;
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;
    if (year < 100) {
      year += year >= 70 ? 1900 : 2000;
    }
    const dd = day.toString().padStart(2, '0');
    const mm = month.toString().padStart(2, '0');
    const yyyy = year.toString().padStart(4, '0');
    return `${dd}.${mm}.${yyyy}`;
  }

  private monthFromName(token: string): number | null {
    if (!token) return null;
    const sanitized = this.stripDiacritics(token).toLowerCase().replace(/\./g, '');
    return this.monthLookup[sanitized] ?? null;
  }

  private stripDiacritics(value: string): string {
    if (!value) return '';
    if (typeof value.normalize === 'function') {
      return value
        .normalize('NFD')
        .replace(/[ -]/g, '')
        .replace(/[-]/g, '')
        .replace(/[ -]/g, '')
        .replace(/[\u0300-\u036f]/g, '');
    }
    return value
      .replace(/[äÄ]/g, 'ae')
      .replace(/[öÖ]/g, 'oe')
      .replace(/[üÜ]/g, 'ue')
      .replace(/[ß]/g, 'ss');
  }

  private buildFormattedLines(text: string): FormattedExtractedLine[] {
    if (!text) return [];

    const lines = text.split(/\r?\n/);
    const formatted: FormattedExtractedLine[] = [];

    for (let index = 0; index < lines.length; index++) {
      const raw = lines[index] ?? '';
      const trimmed = raw.trim();
      const normalized = this.stripDiacritics(trimmed).toLowerCase();
      const classList: string[] = [];

      if (!trimmed) {
        classList.push('is-blank');
      } else {
        const hasDueKeyword = this.dueKeywords.some(keyword => normalized.includes(keyword));
        const hasAmountKeyword = this.amountKeywords.some(keyword => normalized.includes(keyword));
        const containsDate = Boolean(this.findDateInLine(trimmed));
        const containsAmount = this.extractAmountsFromLine(trimmed).length > 0;

        if (hasDueKeyword) classList.push('has-due-keyword');
        if (hasAmountKeyword) classList.push('has-amount-keyword');
        if (containsDate) classList.push('contains-date');
        if (containsAmount) classList.push('contains-amount');

        if (classList.length) {
          classList.push('is-highlighted');
        }
      }

      formatted.push({
        index,
        text: trimmed ? trimmed.replace(/\s{2,}/g, ' ') : '',
        classList
      });
    }

    return formatted;
  }

  private extractAmountsFromLine(text: string): Array<{ value: number; currency?: string }> {
    if (!text) return [];
    const results: Array<{ value: number; currency?: string }> = [];
    const numberRegex = /-?\d{1,3}(?:[’'\s.,]\d{3})*(?:[.,]\d{2}|[.,][-–—])?/g;
    let match: RegExpExecArray | null;
    while ((match = numberRegex.exec(text)) !== null) {
      let raw = match[0];
      if (/[.,][-–—]$/.test(raw)) {
        raw = raw.slice(0, -2) + (raw.includes(',') ? ',00' : '.00');
      }

      const numeric = this.parseAmountValue(raw);
      
      // Skip invalid amounts
      if (!Number.isFinite(numeric)) continue;
      
      // Skip amounts that are clearly not invoice amounts
      // Too small (< 0.5) or too large (> 1,000,000)
      if (numeric < 0.5 || numeric > 1000000) continue;

      const before = text.slice(Math.max(0, match.index - 10), match.index);
      const after = text.slice(match.index + match[0].length, match.index + match[0].length + 10);
      const currency = this.detectCurrency(before) || this.detectCurrency(after);
      results.push({ value: Math.abs(numeric), currency });
    }
    return results;
  }

  private parseAmountValue(raw: string): number {
    if (!raw) return NaN;
    let cleaned = raw
      .replace(/’/g, "'")
      .replace(/[\s']/g, '')
      .replace(/−/g, '-')
      .replace(/–/g, '-')
      .replace(/—/g, '-');

    const lastCommaIdx = cleaned.lastIndexOf(',');
    const lastDotIdx = cleaned.lastIndexOf('.');
    const commaIsDecimal = lastCommaIdx > -1 && (lastDotIdx === -1 || lastCommaIdx > lastDotIdx) && 
                          cleaned.slice(lastCommaIdx + 1).match(/^\d{2}(?:\D|$)/);
    
    if (commaIsDecimal) {
      cleaned = cleaned.replace(/\./g, '').replace(/,/g, '.');
    } else if (lastDotIdx > lastCommaIdx && lastCommaIdx > -1) {
      cleaned = cleaned.replace(/,/g, '');
    } else if (lastCommaIdx > -1) {
      const afterComma = cleaned.slice(lastCommaIdx + 1).match(/^\d+/);
      if (afterComma && afterComma[0].length === 2) {
        cleaned = cleaned.replace(/\./g, '').replace(/,/g, '.');
      } else {
        cleaned = cleaned.replace(/,/g, '');
      }
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }

    cleaned = cleaned.replace(/[^0-9.-]/g, '');
    return parseFloat(cleaned);
  }

  private detectCurrency(fragment: string): string | undefined {
    if (!fragment) return undefined;
    const match = fragment.match(/(SFR|FR\.?|CHF|EUR|USD|CAD|AUD|NZD|GBP|SEK|NOK|DKK|JPY|CNY|INR|€|\$|£)/i);
    if (!match) return undefined;
    return this.resolveCurrency(match[1]);
  }

  private resolveCurrency(token?: string): string | undefined {
    if (!token) return undefined;
    const trimmed = token.trim();
    if (!trimmed) return undefined;
    const upper = trimmed.toUpperCase();
    if (upper === '€') return 'EUR';
    if (upper === '$' || upper === 'US$') return 'USD';
    if (upper.endsWith('$')) {
      const code = upper.replace(/\$/g, '');
      if (this.supportedCurrencies.has(code)) {
        return code;
      }
    }
    if (upper === '£') return 'GBP';
    if (upper === 'SFR' || upper === 'FR.' || upper === 'FR' || upper === 'CHF') return 'CHF';
    if (this.supportedCurrencies.has(upper)) {
      return upper;
    }
    return undefined;
  }

  private formatAmountValue(value: number, currency?: string): string {
    if (!Number.isFinite(value)) {
      return '—';
    }
    const absolute = Math.abs(value);
    try {
      if (currency && this.supportedCurrencies.has(currency)) {
        return new Intl.NumberFormat('de-CH', {
          style: 'currency',
          currency,
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }).format(absolute);
      }

      return new Intl.NumberFormat('de-CH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(absolute);
    } catch {
      return (currency ? `${currency} ` : '') + absolute.toFixed(2);
    }
  }

  private triggerToast(
    message: string,
    palette: { background?: string; color?: string; sound?: 'success' | 'info' | 'error' } = {}
  ): void {
    const id = ++this.toastIdCounter;
    const background = this.withAlpha(palette.background ?? '#2563eb', 0.9);
    const color = palette.color ?? '#ffffff';
    this.toasts.update(list => [...list, { id, message, background, color, leaving: false }]);
    const timeoutId = setTimeout(() => this.startToastExit(id), 3500);
    this.toastTimers.set(id, timeoutId);
    this.playToastSound(palette.sound ?? 'info');
  }

  private startToastExit(id: number): void {
    const toast = this.toasts().find(item => item.id === id);
    if (!toast || toast.leaving) {
      return;
    }

    const existingTimer = this.toastTimers.get(id);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.toastTimers.delete(id);
    }

    this.toasts.update(list => list.map(item => item.id === id ? { ...item, leaving: true } : item));

    const exitTimer = setTimeout(() => this.finishToastRemoval(id), 280);
    this.toastTimers.set(id, exitTimer);
  }

  private finishToastRemoval(id: number): void {
    const timeoutId = this.toastTimers.get(id);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.toastTimers.delete(id);
    }
    this.toasts.update(list => list.filter(toast => toast.id !== id));
  }

  private withAlpha(color: string, alpha: number): string {
    if (color.startsWith('rgba') || color.startsWith('hsla')) {
      return color;
    }
    if (!color.startsWith('#')) {
      return color;
    }

    let hex = color.slice(1);
    if (hex.length === 3) {
      hex = hex.split('').map(ch => ch + ch).join('');
    }

    if (hex.length !== 6) {
      return color;
    }

    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const clampedAlpha = Math.min(1, Math.max(0, alpha));
    return `rgba(${r}, ${g}, ${b}, ${clampedAlpha})`;
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
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.8);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.8);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    } catch (err) {
      console.warn('Toast sound could not be played', err);
    }
  }
}
