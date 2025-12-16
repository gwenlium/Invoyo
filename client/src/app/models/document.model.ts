export type DocumentStatus = 'paid' | 'unpaid' | 'archived' | 'unarchived' | 'saved';

export interface DocumentItem {
  id: string;
  filename: string;
  status: DocumentStatus;
  uploaded_at: string;
  processed_at?: string;
  extracted_text?: string;
  confidence_score?: number;
  error_message?: string;
  content_type?: string;
  derived_due?: string | null;
  derived_amount?: string | null;
  derived_paid?: string | null;
  confirmed_due_date?: string | null;
  confirmed_amount?: string | null;
  qr_code_data?: string | null;
  qr_code_base64?: string | null;
}

export interface DocumentListResponse {
  items: DocumentItem[];
  total: number;
  skip: number;
  limit: number;
}
