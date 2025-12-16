import { Injectable } from '@angular/core';
import QRCode from 'qrcode';

@Injectable({
  providedIn: 'root'
})
export class QRCodeService {
  /**
   * Generate QR code and return as data URL
   */
  async generateQRCode(text: string): Promise<string> {
    try {
      return await QRCode.toDataURL(text, {
        errorCorrectionLevel: 'H',
        margin: 1,
        width: 200
      });
    } catch (error) {
      console.error('Error generating QR code:', error);
      throw error;
    }
  }

  /**
   * Generate QR code for invoice reference
   */
  async generateInvoiceQRCode(filename: string, amount: string, date: string): Promise<string> {
    const reference = `${filename} | ${amount} | ${date}`;
    return this.generateQRCode(reference);
  }
}
