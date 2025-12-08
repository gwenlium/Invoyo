import { Routes } from '@angular/router';
import { InvoiceListComponent } from './components/invoice-list/invoice-list.component';

export const routes: Routes = [
  { path: '', component: InvoiceListComponent },
  { path: 'invoices', redirectTo: '', pathMatch: 'full' },
];
