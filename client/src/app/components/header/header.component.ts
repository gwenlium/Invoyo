import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-header-bar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './header.component.html',
  styleUrl: './header.component.css'
})
export class HeaderComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  user = computed(() => this.auth.getCurrentUser());

  onLogout() {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }
}
