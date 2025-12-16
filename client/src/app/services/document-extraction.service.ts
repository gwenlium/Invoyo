import { Injectable } from '@angular/core';
import { DocumentItem } from '../models/document.model';

export interface AmountMatch {
  value: number;
  raw: string;
  lineIndex: number;
}

@Injectable({
  providedIn: 'root'
})
export class DocumentExtractionService {
  private readonly dueKeywords = [
    'due date', 'due-date', 'payment due', 'payment deadline', 'due on',
    'fällig', 'faellig', 'zahlbar', 'zahlungsziel', 'verfall',
    'scadenza', 'scad.', 'vencimiento', 'vence', 'deadline'
  ];

  private readonly amountKeywords = [
    'total', 'amount', 'betrag', 'summe', 'balance', 'saldo', 'netto',
    'grand total', 'solde', 'importo', 'montante', 'importe', 'monto',
    'invoice amount', 'factura', 'rechnung'
  ];

  /**
   * Extract invoice date from document text
   */
  deriveInvoiceDate(doc: DocumentItem): string {
    const text = doc.extracted_text || '';
    if (!text.trim()) return '';

    const lines = text.split('\n');

    for (const line of lines) {
      if (this.containsDateKeyword(line)) {
        const found = this.findDateInLine(line);
        if (found) return found;
      }
    }

    // Fallback: check all lines
    for (const line of lines) {
      const found = this.findDateInLine(line);
      if (found) return found;
    }

    return '';
  }

  /**
   * Extract amount from document text
   */
  deriveAmount(doc: DocumentItem): string {
    const text = doc.extracted_text || '';
    if (!text.trim()) return '';

    const lines = text.split('\n');
    const candidates: AmountMatch[] = [];

    // First pass: lines with amount keywords
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lowerLine = line.toLowerCase();

      if (this.amountKeywords.some(kw => lowerLine.includes(kw))) {
        const matches = this.extractAmountsFromLine(line, i);

        if (matches.length > 0) {
          for (const match of matches) {
            if (match.value >= 10 && match.value <= 999999) {
              candidates.push(match);
            }
          }
        }

        // If no amount on same line, check next line
        if (matches.length === 0 && i + 1 < lines.length) {
          const nextMatches = this.extractAmountsFromLine(lines[i + 1], i + 1);

          for (const match of nextMatches) {
            if (match.value >= 10 && match.value <= 999999) {
              candidates.push(match);
            }
          }
        }
      }
    }

    // Second pass: fall back to any amount if no keyword matches
    if (candidates.length === 0) {
      for (const line of lines) {
        const matches = this.extractAmountsFromLine(line, lines.indexOf(line));

        for (const match of matches) {
          if (match.value >= 10 && match.value <= 999999) {
            candidates.push(match);
          }
        }
      }
    }

    // Third pass: include larger amounts if nothing found
    if (candidates.length === 0) {
      for (const line of lines) {
        const matches = this.extractAmountsFromLine(line, lines.indexOf(line));

        for (const match of matches) {
          if (match.value >= 100 && match.value <= 9999999) {
            candidates.push(match);
          }
        }
      }
    }

    // Select best candidate
    if (candidates.length === 0) {
      const largeAmounts = this.extractAllAmounts(text).filter(
        m => m.value >= 1000
      );

      if (largeAmounts.length > 0) {
        return largeAmounts[0].raw;
      }

      return '';
    }

    // Return the most likely candidate (highest value with keyword proximity)
    if (!candidates.length) {
      return '';
    }

    const selected = candidates.reduce((prev, curr) =>
      prev.value > curr.value ? prev : curr
    );

    return selected.raw;
  }

  /**
   * Extract all monetary amounts from a string
   */
  private extractAmountsFromLine(line: string, lineIndex: number): AmountMatch[] {
    const patterns = [
      /\d+[.,]\d{2}(?:\s*(?:EUR|CHF|USD|\$|€|£|¥))?/g, // 123.45 EUR
      /(?:EUR|CHF|USD|\$|€|£|¥)?\s*\d+[.,]\d{2}/g, // EUR 123.45
      /\d+(?:[.,]\d{3})*[.,]\d{2}/g // 1,234.56 or 1.234,56
    ];

    const matches: AmountMatch[] = [];

    for (const pattern of patterns) {
      const found = line.match(pattern) || [];

      for (const raw of found) {
        const amount = this.parseAmount(raw);
        if (amount > 0) {
          matches.push({ value: amount, raw, lineIndex });
        }
      }
    }

    return matches;
  }

  /**
   * Extract all amounts from text
   */
  private extractAllAmounts(text: string): AmountMatch[] {
    const lines = text.split('\n');
    const amounts: AmountMatch[] = [];

    lines.forEach((line, index) => {
      amounts.push(...this.extractAmountsFromLine(line, index));
    });

    return amounts;
  }

  /**
   * Parse amount string to number
   */
  private parseAmount(amountStr: string): number {
    const cleaned = amountStr
      .replace(/[^\d.,]/g, '')
      .trim();

    if (!cleaned) return 0;

    // Handle both . and , as decimal separator
    const parts = cleaned.split(/[.,]/);

    if (parts.length === 2) {
      const integer = parts[0].replace(/[.,]/g, '');
      const decimal = parts[1];
      return parseFloat(`${integer}.${decimal}`);
    } else if (parts.length === 3) {
      const integer = parts[0] + parts[1];
      const decimal = parts[2];
      return parseFloat(`${integer}.${decimal}`);
    }

    return parseFloat(cleaned) || 0;
  }

  /**
   * Find date pattern in a single line
   */
  private findDateInLine(line: string): string | null {
    const fragments = [
      /(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/,
      /(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})/,
      /([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/,
      /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/
    ];

    for (const pattern of fragments) {
      const match = line.match(pattern);

      if (match) {
        const normalized = this.normalizeDate(line.substring(match.index || 0, (match.index || 0) + match[0].length));

        if (normalized) {
          return normalized;
        }
      }
    }

    return null;
  }

  /**
   * Normalize date string to YYYY-MM-DD format
   */
  private normalizeDate(input?: string | null): string | null {
    if (!input) return null;

    // ISO datetime (2024-01-15T10:30:00)
    const isoDateTime = input.match(/(\d{4})-(\d{2})-(\d{2})/);

    if (isoDateTime) {
      return `${isoDateTime[1]}-${isoDateTime[2]}-${isoDateTime[3]}`;
    }

    // DD.MM.YYYY or DD/MM/YYYY
    let parts = input.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);

    if (parts) {
      const day = parseInt(parts[1]);
      const month = parseInt(parts[2]);
      const year = parseInt(parts[3]);

      return this.formatDateParts(day, month, year);
    }

    // YYYY-MM-DD or YYYY/MM/DD
    parts = input.match(/(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})/);

    if (parts) {
      const year = parseInt(parts[1]);
      const month = parseInt(parts[2]);
      const day = parseInt(parts[3]);

      return this.formatDateParts(day, month, year);
    }

    // Month name variants: "January 15, 2024" or "15 January 2024"
    parts = input.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);

    if (parts) {
      const month = this.monthFromName(parts[1]);
      const day = parseInt(parts[2]);
      const year = parseInt(parts[3]);

      if (month) {
        return this.formatDateParts(day, month, year);
      }
    }

    // German/French: "15. Januar 2024"
    parts = input.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);

    if (parts) {
      const day = parseInt(parts[1]);
      const month = this.monthFromName(parts[2]);
      const year = parseInt(parts[3]);

      if (month) {
        return this.formatDateParts(day, month, year);
      }
    }

    return null;
  }

  /**
   * Format date parts into YYYY-MM-DD string
   */
  private formatDateParts(day: number, month: number, year: number): string | null {
    if (day < 1 || day > 31 || month < 1 || month > 12) {
      return null;
    }

    if (year < 100) {
      year += year < 50 ? 2000 : 1900;
    }

    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  /**
   * Get month number from month name
   */
  private monthFromName(token: string): number | null {
    const monthMap: { [key: string]: number } = {
      january: 1, januar: 1, janvier: 1, enero: 1, gennaio: 1,
      february: 2, februar: 2, février: 2, febrero: 2, febbraio: 2,
      march: 3, märz: 3, mars: 3, marzo: 3,
      april: 4, avril: 4, abril: 4, aprile: 4,
      may: 5, mai: 5, mayo: 5, maggio: 5,
      june: 6, juni: 6, juin: 6, junio: 6, giugno: 6,
      july: 7, juli: 7, juillet: 7, julio: 7, luglio: 7,
      august: 8, août: 8, agosto: 8,
      september: 9, septembre: 9, septiembre: 9, settembre: 9,
      october: 10, oktober: 10, octobre: 10, octubre: 10, ottobre: 10,
      november: 11, novembre: 11, noviembre: 11,
      december: 12, dezember: 12, décembre: 12, diciembre: 12, dicembre: 12
    };

    const key = this.stripDiacritics(token).toLowerCase();
    return monthMap[key] || null;
  }

  /**
   * Strip diacritics from string
   */
  private stripDiacritics(value: string): string {
    if (typeof value.normalize === 'function') {
      return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    return value;
  }

  /**
   * Check if line contains date keyword
   */
  private containsDateKeyword(line: string): boolean {
    const lower = line.toLowerCase();
    return this.dueKeywords.some(kw => lower.includes(kw));
  }
}
