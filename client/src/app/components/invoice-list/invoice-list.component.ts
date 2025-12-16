import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpEventType } from '@angular/common/http';
import { Subject, Subscription } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { DocumentService } from '../../services/document.service';
import { DocumentExtractionService } from '../../services/document-extraction.service';
import { DocumentFormattingService, FormattedExtractedLine } from '../../services/document-formatting.service';
import { QRCodeService } from '../../services/qr-code.service';
import { AudioService } from '../../services/audio.service';
import { DocumentItem } from '../../models/document.model';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

type ColumnFilterKeys = 'filename' | 'state' | 'date' | 'amount' | 'status' | 'uploaded' | 'processed';
type TabKey = 'all' | 'unpaid' | 'paid' | 'archived';

interface ToastMessage {
  id: number;
  message: string;
  background: string;
  color: string;
  leaving?: boolean;
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
  private uploadSubscription?: Subscription;

  constructor(
    private documentService: DocumentService,
    private extractionService: DocumentExtractionService,
    private formattingService: DocumentFormattingService,
    private qrCodeService: QRCodeService,
    private audioService: AudioService,
    private auth: AuthService,
    private router: Router
  ) {}

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

  get currentUsername(): string {
    const u = this.auth.getCurrentUser();
    return u?.username || u?.email || 'User';
  }

  logout() {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }

  isAdmin(): boolean {
    const user = this.auth.getCurrentUser();
    return user?.role === 'admin';
  }

  goToAdminPanel() {
    this.router.navigate(['/admin']);
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
          
          // Show animation only once on initial page load
          if (!this.animationHasPlayed && merged.length > 0) {
            this.animationHasPlayed = true;
            this.hasInitiallyLoaded.set(true);
            // Remove the animation class after all animations complete (quite important lol)
            setTimeout(() => this.hasInitiallyLoaded.set(false), 1500);
          }
        }

        // Poll if we have saved docs that might still be getting processed
        const hasActiveWork = resp.items.some(d => 
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
    return this.formattingService.buildFormattedLines(text);
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
      this.triggerToast('Extracted text copied', { background: '#2563eb', color: '#ffffff' });
    } catch (err) {
      console.error('Failed to copy extracted text:', err);
      this.triggerToast('Could not copy text', { background: '#ef4444', color: '#ffffff' });
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
          return doc.status === 'unpaid' || doc.status === 'saved';
        }
        if (tab === 'paid') {
          return doc.status === 'paid';
        }
        if (tab === 'archived') {
          return doc.status === 'archived' || doc.status === 'unarchived';
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
        this.triggerToast('File deleted', { background: '#ef4444', color: '#ffffff' });
        this.cancelDelete(event);
      },
      error: () => {
        this.triggerToast('Failed to delete document', { background: '#ef4444', color: '#ffffff' });
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
            color: '#ffffff'
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
        this.triggerToast('Upload failed', { background: '#ef4444', color: '#ffffff' });
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
        this.triggerToast('Invoice details saved', { background: '#22c55e', color: '#ffffff' });
      },
      error: () => this.triggerToast('Failed to save invoice details', { background: '#ef4444', color: '#ffffff' })
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
        this.triggerToast('Marked as paid', { background: '#22c55e', color: '#ffffff' });
      },
      error: () => this.triggerToast('Failed to mark as paid', { background: '#ef4444', color: '#ffffff' })
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
        this.triggerToast('Archived', { background: '#3b82f6', color: '#ffffff' });
      },
      error: () => this.triggerToast('Failed to archive document', { background: '#ef4444', color: '#ffffff' })
    });
  }

  // Template expects `archive(doc, $event)`; provide a thin wrapper to match name.
  archive(doc: DocumentItem, event?: Event): void {
    this.archiveDocument(doc, event);
  }

  // Allow marking a document as unpaid (revert to unpaid state).
  markAsUnpaid(doc: DocumentItem, event?: Event): void {
    if (event) event.stopPropagation();
    this.justExpandedDocId.set(null); // Prevent animation on status change
    this.documentService.update(doc.id, { 
      status: 'unpaid',
      processed_at: new Date().toISOString()
    }).subscribe({
      next: (updatedDoc) => {
        const stamped = { ...updatedDoc, processed_at: updatedDoc.processed_at ?? new Date().toISOString() };
        this.setClientModified(stamped.id, stamped);
        this.triggerToast('Marked as unpaid', { background: '#f97316', color: '#ffffff' });
      },
      error: () => this.triggerToast('Failed to mark as unpaid', { background: '#ef4444', color: '#ffffff' })
    });
  }

  // Allow unarchiving a document (revert to paid state).
  unarchive(doc: DocumentItem, event?: Event): void {
    if (event) event.stopPropagation();
    this.justExpandedDocId.set(null);
    this.documentService.update(doc.id, { 
      status: 'paid',
      processed_at: new Date().toISOString()
    }).subscribe({
      next: (updatedDoc) => {
        const stamped = { ...updatedDoc, processed_at: updatedDoc.processed_at ?? new Date().toISOString() };
        this.setClientModified(stamped.id, stamped);
        this.triggerToast('Unarchived', { background: '#3b82f6', color: '#ffffff' });
      },
      error: () => this.triggerToast('Failed to unarchive', { background: '#ef4444', color: '#ffffff' })
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
        this.triggerToast('Failed to open file', { background: '#ef4444', color: '#ffffff' });
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
    this.audioService.stop();
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
      case 'unpaid':
        return 'status-unpaid';
      case 'archived':
        return 'status-archived';
      case 'unarchived':
        return 'status-unarchived';
      case 'saved':
        return 'status-saved';
      default:
        return 'status-default';
    }
  }

  statusLabel(status: DocumentItem['status']): string {
    switch (status) {
      case 'saved':
        return 'Saved';
      case 'paid':
        return 'Paid';
      case 'unpaid':
        return 'Unpaid';
      case 'archived':
        return 'Archived';
      case 'unarchived':
        return 'Unarchived';
      default:
        return status;
    }
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
    return this.extractionService.deriveInvoiceDate(doc);
  }

  deriveAmount(doc: DocumentItem): string {
    return this.extractionService.deriveAmount(doc);
  }

  derivePaidStatus(doc: DocumentItem): string {
    if (doc.status === 'paid' || doc.status === 'archived') return 'Paid';
    if (doc.derived_paid) return doc.derived_paid;
    const text = (doc.extracted_text || '').toLowerCase();
    if (text.includes('bezahlt') || text.includes('paid')) return 'Paid';
    // For unpaid or saved documents, default to unpaid
    if (doc.status === 'unpaid' || doc.status === 'saved') return 'Unpaid';
    // For any document with extracted text or derived_amount, default to unpaid if not marked paid
    if (doc.extracted_text || doc.derived_amount) return 'Unpaid';
    return 'Pending';
  }

  hasExtractedData(doc: DocumentItem): boolean {
    return !!(doc.extracted_text && doc.extracted_text.trim().length > 0);
  }

  showUnpaidLabel(doc: DocumentItem): boolean {
    // Show Unpaid label for documents explicitly marked as unpaid
    if (doc.status === 'unpaid') {
      return true;
    }
    // Also show for saved documents with extracted data (processing)
    if (doc.status === 'saved' && this.hasExtractedData(doc)) {
      return true;
    }
    return false;
  }

  getQRCodeUrl(docId: string): string | undefined {
    return this.qrCodeUrls().get(docId);
  }

  private async generateQRCode(docId: string, data: string): Promise<void> {
    try {
      const dataUrl = await this.qrCodeService.generateQRCode(data);
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
    palette: { background?: string; color?: string } = {}
  ): void {
    const id = ++this.toastIdCounter;
    const background = this.withAlpha(palette.background ?? '#2563eb', 0.9);
    const color = palette.color ?? '#ffffff';
    this.toasts.update(list => [...list, { id, message, background, color, leaving: false }]);
    const timeoutId = setTimeout(() => this.startToastExit(id), 3500);
    this.toastTimers.set(id, timeoutId);
    // Determine sound type from background color for audio feedback
    const soundType = palette.background?.includes('22c55e') ? 'success' : palette.background?.includes('ef4444') ? 'error' : 'info';
    this.audioService.playToastSound(soundType);
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
}


