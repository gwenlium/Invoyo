import { Injectable } from '@angular/core';
import { DocumentItem } from '../models/document.model';

export interface FormattedExtractedLine {
  index: number;
  text: string;
  classList: string[];
}

interface CachedLines {
  source: string;
  lines: FormattedExtractedLine[];
}

@Injectable({
  providedIn: 'root'
})
export class DocumentFormattingService {
  private formattedLinesCache = new Map<string, CachedLines>();

  /**
   * Format extracted text with highlighting for dates and amounts
   */
  formattedExtractedText(doc: DocumentItem): FormattedExtractedLine[] {
    const text = doc.extracted_text || '';
    const cacheKey = doc.id;

    // Check cache
    const cached = this.formattedLinesCache.get(cacheKey);
    if (cached && cached.source === text) {
      return cached.lines;
    }

    const lines = this.buildFormattedLines(text);
    this.formattedLinesCache.set(cacheKey, { source: text, lines });

    return lines;
  }

  /**
   * Build formatted lines with CSS classes for highlighting
   */
  buildFormattedLines(text: string): FormattedExtractedLine[] {
    const lines = text.split('\n');
    const formatted: FormattedExtractedLine[] = [];

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const classList: string[] = [];

      if (!line.trim()) {
        continue;
      }

      // Add formatting classes based on content
      if (this.looksLikeAmount(line)) {
        classList.push('amount-line');
      }

      if (this.looksLikeDate(line)) {
        classList.push('date-line');
      }

      formatted.push({
        index,
        text: line,
        classList
      });
    }

    return formatted;
  }

  /**
   * Detect if line looks like a monetary amount
   */
  private looksLikeAmount(line: string): boolean {
    const amountPattern = /\d+[.,]\d{2}|€|£|$|CHF|USD/i;
    return amountPattern.test(line) && line.length < 100;
  }

  /**
   * Detect if line looks like a date
   */
  private looksLikeDate(line: string): boolean {
    const datePatterns = [
      /\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}/,        // DD.MM.YYYY
      /\d{4}[.\/-]\d{1,2}[.\/-]\d{1,2}/,          // YYYY-MM-DD
      /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*/i, // Month names
      /(?:Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)/i // German
    ];

    return datePatterns.some(pattern => pattern.test(line)) && line.length < 100;
  }

  /**
   * Track by function for ngFor optimization
   */
  trackFormattedLine(_index: number, line: FormattedExtractedLine): number {
    return line.index;
  }

  /**
   * Format local date-time for display
   */
  formatLocalDateTime(date: Date): string {
    if (!date) return '';
    const iso = date.toISOString().split('T')[0];
    const time = date.toTimeString().split(' ')[0];
    return `${iso} ${time}`;
  }

  /**
   * Format timestamp string or Date for display
   */
  formatTimestamp(timestamp: string | Date): string {
    if (!timestamp) return '';

    let date: Date;
    if (typeof timestamp === 'string') {
      date = new Date(timestamp);
    } else {
      date = timestamp;
    }

    if (isNaN(date.getTime())) {
      return '';
    }

    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    };

    return date.toLocaleString('en-CH', options);
  }
}
