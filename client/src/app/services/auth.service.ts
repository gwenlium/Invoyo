import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs/operators';

interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

interface RegisterRequest {
  email: string;
  username: string;
  password: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private accessKey = 'invoyo_access';
  private refreshKey = 'invoyo_refresh';
  private firstWelcomeKey = 'invoyo_welcome_played';
  accessToken = signal<string | null>(this.getStored(this.accessKey));

  constructor(private http: HttpClient) {}

  register(body: RegisterRequest) {
    return this.http.post('/api/auth/register', body);
  }

  login(username: string, password: string) {
    return this.http
      .post<LoginResponse>('/api/auth/login', { username, password })
      .pipe(
        tap((resp) => {
          this.setTokens(resp.access_token, resp.refresh_token);
          this.playWelcomeIfFirstLogin();
        })
      );
  }

  logout() {
    this.setTokens(null, null);
  }

  getToken() {
    return this.accessToken();
  }

  isAuthenticated(): boolean {
    return !!this.getToken();
  }

  getCurrentUser(): { username?: string; email?: string; role?: string } | null {
    const token = this.getToken();
    if (!token) return null;
    try {
      const payload = this.decodeJwt(token);
      return {
        username: payload?.username,
        email: payload?.email,
        role: payload?.role
      };
    } catch {
      return null;
    }
  }

  private setTokens(access: string | null, refresh: string | null) {
    this.setStored(this.accessKey, access);
    this.setStored(this.refreshKey, refresh);
    this.accessToken.set(access);
  }

  private getStored(key: string): string | null {
    return localStorage.getItem(key);
  }

  private setStored(key: string, val: string | null) {
    if (val) localStorage.setItem(key, val);
    else localStorage.removeItem(key);
  }

  private decodeJwt(token: string): any | null {
    // Base64URL decode the payload segment
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const json = atob(padded);
    return JSON.parse(json);
  }

  private playWelcomeIfFirstLogin() {
    if (localStorage.getItem(this.firstWelcomeKey)) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(880, ctx.currentTime);
      o.connect(g);
      g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
      o.stop(ctx.currentTime + 0.32);
    } catch {
      // ignore audio errors
    }
    localStorage.setItem(this.firstWelcomeKey, '1');
  }
}
