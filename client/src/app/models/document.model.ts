export type DocumentStatus = 'pending' | 'processing' | 'processed' | 'failed';

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
}

export interface DocumentListResponse {
  items: DocumentItem[];
  total: number;
  skip: number;
  limit: number;
}
