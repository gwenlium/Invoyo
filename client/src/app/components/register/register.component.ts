import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './register.component.html',
  styleUrl: './register.component.css'
})
export class RegisterComponent {
  email = '';
  username = '';
  password = '';
  loading = false;
  error: string | null = null;

  constructor(private auth: AuthService, private router: Router) {}

  onSubmit() {
    this.loading = true;
    this.error = null;
    this.auth
      .register({ email: this.email, username: this.username, password: this.password })
      .subscribe({
        next: () => {
          // Auto-login after successful registration
          this.auth.login(this.username, this.password).subscribe({
            next: () => {
              this.loading = false;
              this.router.navigateByUrl('/').catch((err) => {
                this.error = 'Navigation failed: ' + err?.message;
                this.loading = false;
              });
            },
            error: (err) => {
              this.loading = false;
              // Fallback: send to login if auto-login fails
              this.error = 'Auto-login failed, please log in manually';
              this.router.navigateByUrl('/login');
            }
          });
        },
        error: (err) => {
          this.loading = false;
          this.error = err?.error?.detail || 'Registration failed';
        }
      });
  }

  goLogin() {
    this.router.navigateByUrl('/login');
  }
}
