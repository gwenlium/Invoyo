import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DocumentService } from '../../services/document.service';
import { HttpEventType } from '@angular/common/http';

@Component({
  selector: 'app-upload',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './upload.component.html',
  styleUrls: ['./upload.component.css']
})
export class UploadComponent {
  fileName = signal<string>('');
  progress = signal<number>(0);
  message = signal<string>('');
  error = signal<string>('');
  isUploading = signal<boolean>(false);

  constructor(private documents: DocumentService) {}

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];
    this.fileName.set(file.name);
    this.upload(file);
    input.value = '';
  }

  upload(file: File) {
    this.progress.set(0);
    this.message.set('');
    this.error.set('');
    this.isUploading.set(true);

    this.documents.upload(file).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress && event.total) {
          const percent = Math.round((100 * event.loaded) / event.total);
          this.progress.set(percent);
        }
        if (event.type === HttpEventType.Response) {
          this.message.set(`Uploaded and processed: ${event.body?.filename}`);
          this.isUploading.set(false);
        }
      },
      error: (err) => {
        this.error.set(err?.error?.detail || 'Upload failed');
        this.isUploading.set(false);
      },
    });
  }
}
