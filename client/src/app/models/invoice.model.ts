export interface Invoice {
  id: string;
  filename: string;
  status: 'pending' | 'processing' | 'processed' | 'failed';
  uploaded_at: string;
  processed_at?: string;
  extracted_text?: string;
  // Matching the frontend display logic
  vendor_name: string;
  amount: number;
  due_date: string;
}

export interface InvoiceListResponse {
  items: Invoice[];
  total: number;
  skip: number;
  limit: number;
}
