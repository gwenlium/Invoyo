import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-header-bar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <header class="app-header">
      <div class="brand">Invoyo</div>
      <div class="spacer"></div>
      <div class="user" *ngIf="user() as u; else guest">
        <span class="who">{{ u.username || u.email }}</span>
        <button type="button" class="logout" (click)="onLogout()">Logout</button>
      </div>
      <ng-template #guest>
        <span class="who muted">Not signed in</span>
      </ng-template>
    </header>
  `,
  styles: [
    `
    .app-header { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-bottom: 1px solid #eee; position: sticky; top: 0; background: #fff; z-index: 10; }
    .brand { font-weight: 600; letter-spacing: 0.3px; }
    .spacer { flex: 1; }
    .who { margin-right: 8px; }
    .who.muted { color: #666; }
    .logout { border: 1px solid #ddd; background: #fafafa; padding: 4px 10px; border-radius: 6px; cursor: pointer; }
    .logout:hover { background: #f0f0f0; }
    `
  ]
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
