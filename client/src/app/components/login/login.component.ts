import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="auth-wrap">
      <div class="auth-card">
        <h2>Hey!</h2>
        <form (ngSubmit)="onSubmit()" #f="ngForm">
          <label>
            Username
            <input name="username" [(ngModel)]="username" required />
          </label>
          <label>
            Password
            <input type="password" name="password" [(ngModel)]="password" required />
          </label>
          <button class="primary glow" type="submit" [disabled]="f.invalid || loading">Login</button>
        </form>
        <p *ngIf="error" class="error">{{ error }}</p>
        <button class="ghost glow" type="button" (click)="goRegister()">Create an account</button>
      </div>
    </div>
  `,
  styles: [`
    .auth-wrap { display:flex; min-height: 60vh; align-items: center; justify-content: center; }
    .auth-card { width: 360px; display: grid; gap: 12px; padding: 20px; border: 1px solid #eee; border-radius: 12px; background: #fff; box-shadow: 0 8px 20px rgba(15,23,42,0.06); }
    h2 { margin: 0 0 15px; }
    label { display: grid; gap: 4px; font-size: 0.95rem; }
    input { padding: 10px; border-radius: 8px; border: 1px solid #ddd; }
    button { padding: 0.6rem 1rem; border-radius: 20px; border: 1px solid #ddd; cursor: pointer; margin-top: 10px; }
    .primary { background-color: #22c55e; color: white; border-color: #22c55e; }
    .ghost { background: transparent; }
    .error { color: #b00020; margin: 0; }
    .divider { text-align: center; color: #6b7280; font-size: 0.85rem; }
    .glow { box-shadow: 0 8px 20px rgba(15,23,42,0.08); }
  `]
})
export class LoginComponent {
  username = '';
  password = '';
  loading = false;
  error: string | null = null;

  constructor(private auth: AuthService, private router: Router) {}

  onSubmit() {
    this.loading = true;
    this.error = null;
    this.auth.login(this.username, this.password).subscribe({
      next: () => this.router.navigateByUrl('/'),
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.detail || 'Login failed';
      }
    });
  }

  goRegister() {
    this.router.navigateByUrl('/register');
  }
}
