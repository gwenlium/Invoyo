import { Routes } from '@angular/router';
import { HomeComponent } from './components/home/home.component';
import { InvoiceListComponent } from './components/invoice-list/invoice-list.component';
import { UploadComponent } from './components/upload/upload.component';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'invoices', component: InvoiceListComponent },
  { path: 'upload', component: UploadComponent },
];
