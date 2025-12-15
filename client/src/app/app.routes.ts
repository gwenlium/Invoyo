import { Routes } from '@angular/router';
import { InvoiceListComponent } from './components/invoice-list/invoice-list.component';
import { LoginComponent } from './components/login/login.component';
import { RegisterComponent } from './components/register/register.component';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'register', component: RegisterComponent },
  { path: '', component: InvoiceListComponent, canActivate: [authGuard] },
  { path: 'invoices', redirectTo: '', pathMatch: 'full' },
  { path: '**', redirectTo: '' },
];
