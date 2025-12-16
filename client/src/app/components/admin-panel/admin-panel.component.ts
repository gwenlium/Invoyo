import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AuthService } from '../../services/auth.service';
import { Router } from '@angular/router';

interface User {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user';
  is_active: boolean;
}

interface ToastMessage {
  id: number;
  message: string;
  background: string;
  color: string;
  leaving?: boolean;
}

@Component({
  selector: 'app-admin-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin-panel.component.html',
  styleUrl: './admin-panel.component.css'
})
export class AdminPanelComponent implements OnInit, OnDestroy {
  users = signal<User[]>([]);
  loading = signal<boolean>(true);
  error = signal<string>('');
  actionInProgress = signal<boolean>(false);
  toasts = signal<ToastMessage[]>([]);
  confirmingDemoteUserId = signal<string | null>(null);
  
  private destroy$ = new Subject<void>();
  private toastIdCounter = 0;
  private toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

  constructor(
    private http: HttpClient,
    private auth: AuthService,
    private router: Router
  ) {}

  ngOnInit() {
    this.loadUsers();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadUsers() {
    this.loading.set(true);
    this.error.set('');
    console.log('Loading users from /api/auth/admin/users');
    this.http.get<any[]>('/api/auth/admin/users')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (users) => {
          console.log('Users loaded successfully:', users);
          // Map the response to ensure correct typing
          const mappedUsers: User[] = users.map(u => ({
            id: u.id,
            username: u.username,
            email: u.email,
            role: ((u.role === 'UserRole.ADMIN' || u.role === 'admin') ? 'admin' : 'user') as 'admin' | 'user',
            is_active: u.is_active ?? true
          }));
          this.users.set(mappedUsers);
          console.log('Mapped users:', mappedUsers);
          this.loading.set(false);
        },
        error: (err) => {
          console.error('Failed to load users:', err);
          this.error.set(err?.error?.detail || err?.message || 'Failed to load users');
          this.loading.set(false);
        }
      });
  }

  promoteToAdmin(user: User) {
    this.actionInProgress.set(true);
    this.error.set('');
    console.log('Promoting user:', user.id);
    this.http.post<any>(`/api/auth/admin/promote/${user.id}`, {})
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (updatedUser) => {
          console.log('User promoted:', updatedUser);
          const users = this.users();
          const index = users.findIndex(u => u.id === user.id);
          if (index >= 0) {
            users[index] = {
              id: updatedUser.id,
              username: updatedUser.username,
              email: updatedUser.email,
              role: (updatedUser.role === 'UserRole.ADMIN' || updatedUser.role === 'admin') ? 'admin' : 'user',
              is_active: updatedUser.is_active ?? true
            };
            this.users.set([...users]);
          }
          this.triggerToast(`${user.username} promoted to admin`, { background: '#22c55e', color: '#ffffff' });
          this.actionInProgress.set(false);
        },
        error: (err) => {
          console.error('Failed to promote user:', err);
          this.triggerToast(err?.error?.detail || 'Failed to promote user', { background: '#ef4444', color: '#ffffff' });
          this.actionInProgress.set(false);
        }
      });
  }

  demoteFromAdmin(user: User) {
    this.actionInProgress.set(true);
    this.confirmingDemoteUserId.set(null);
    this.error.set('');
    console.log('Demoting user:', user.id);
    this.http.post<any>(`/api/auth/admin/demote/${user.id}`, {})
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (updatedUser) => {
          console.log('User demoted:', updatedUser);
          const users = this.users();
          const index = users.findIndex(u => u.id === user.id);
          if (index >= 0) {
            users[index] = {
              id: updatedUser.id,
              username: updatedUser.username,
              email: updatedUser.email,
              role: (updatedUser.role === 'UserRole.ADMIN' || updatedUser.role === 'admin') ? 'admin' : 'user',
              is_active: updatedUser.is_active ?? true
            };
            this.users.set([...users]);
          }
          this.triggerToast(`${user.username} demoted to regular user`, { background: '#3b82f6', color: '#ffffff' });
          this.actionInProgress.set(false);
        },
        error: (err) => {
          console.error('Failed to demote user:', err);
          this.triggerToast(err?.error?.detail || 'Failed to demote user', { background: '#ef4444', color: '#ffffff' });
          this.actionInProgress.set(false);
        }
      });
  }

  isLastAdmin(user: User): boolean {
    if (user.role !== 'admin') return false;
    const adminCount = this.users().filter(u => u.role === 'admin').length;
    return adminCount === 1;
  }

  goBack() {
    this.router.navigateByUrl('/');
  }

  private triggerToast(
    message: string,
    palette: { background?: string; color?: string } = {}
  ): void {
    const id = ++this.toastIdCounter;
    const background = palette.background ?? '#2563eb';
    const color = palette.color ?? '#ffffff';
    this.toasts.update(list => [...list, { id, message, background, color, leaving: false }]);
    const timeoutId = setTimeout(() => this.startToastExit(id), 3500);
    this.toastTimers.set(id, timeoutId);
  }

  private startToastExit(id: number): void {
    const toast = this.toasts().find(item => item.id === id);
    if (!toast || toast.leaving) {
      return;
    }

    const existingTimer = this.toastTimers.get(id);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.toastTimers.delete(id);
    }

    this.toasts.update(list => list.map(item => item.id === id ? { ...item, leaving: true } : item));

    const exitTimer = setTimeout(() => this.finishToastRemoval(id), 280);
    this.toastTimers.set(id, exitTimer);
  }

  private finishToastRemoval(id: number): void {
    const timeoutId = this.toastTimers.get(id);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.toastTimers.delete(id);
    }
    this.toasts.update(list => list.filter(toast => toast.id !== id));
  }

  dismissToast(id: number, event?: Event): void {
    event?.stopPropagation();
    this.startToastExit(id);
  }
}
