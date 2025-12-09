import { Component, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DocumentService } from '../../services/document.service';
import { HttpEventType } from '@angular/common/http';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-upload',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './upload.component.html',
  styleUrls: ['./upload.component.css']
})
export class UploadComponent implements OnDestroy {
  fileName = signal<string>('');
  progress = signal<number>(0);
  message = signal<string>('');
  error = signal<string>('');
  isUploading = signal<boolean>(false);
  private uploadSubscription?: Subscription;

  constructor(private documents: DocumentService) {}

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const files = Array.from(input.files);
    this.fileName.set(files.length === 1 ? files[0].name : `${files.length} files selected`);
    this.uploadFiles(files);
    input.value = '';
  }

  uploadFiles(files: File[]) {
    if (!files.length) return;

    this.uploadSubscription?.unsubscribe();
    this.progress.set(0);
    this.message.set('');
    this.error.set('');
    this.isUploading.set(true);

    const total = files.length;
    let completed = 0;

    this.uploadSubscription = this.documents.uploadBatch(files).subscribe({
      next: ({ event, file, index }) => {
        if (event.type === HttpEventType.UploadProgress) {
          const portion = event.total ? event.loaded / event.total : 0;
          const aggregate = ((completed + portion) / total) * 100;
          this.progress.set(Math.round(aggregate));
          this.message.set(`Uploading ${index + 1}/${total}: ${file.name}`);
        }
        if (event.type === HttpEventType.Response) {
          completed += 1;
          this.progress.set(Math.round((completed / total) * 100));
          this.message.set(`Uploaded ${completed}/${total}`);
        }
      },
      error: (err) => {
        const context = err?.uploadContext;
        const fileName = context?.file?.name ?? 'file';
        this.error.set(err?.error?.detail || `Upload failed for ${fileName}`);
        this.isUploading.set(false);
        this.progress.set(0);
      },
      complete: () => {
        this.isUploading.set(false);
        if (!this.error()) {
          setTimeout(() => this.message.set(''), 3000);
        }
      }
    });
  }

  ngOnDestroy(): void {
    this.uploadSubscription?.unsubscribe();
  }
}
