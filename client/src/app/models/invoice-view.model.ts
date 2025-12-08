export interface InvoiceView {
  id: string;
  vendor_name: string;
  amount: number;
  due_date: string;
  status: 'Paid' | 'Pending' | 'Overdue' | 'Processing' | 'Failed';
}
