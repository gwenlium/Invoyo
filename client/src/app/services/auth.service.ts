import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { tap } from 'rxjs/operators';
import { firstValueFrom } from 'rxjs';

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private tokenKey = 'invoiceprocessor_token';
  token = signal<string | null>(this.getStoredToken());

  constructor(private http: HttpClient) {}

  login(username: string, password: string) {
    const params = new HttpParams().set('username', username).set('password', password);
    return this.http
      .post<TokenResponse>('/api/auth/token', null, { params })
      .pipe(tap((resp) => this.setToken(resp.access_token)));
  }

  setToken(token: string | null) {
    if (token) {
      localStorage.setItem(this.tokenKey, token);
    } else {
      localStorage.removeItem(this.tokenKey);
    }
    this.token.set(token);
  }

  getToken() {
    return this.token();
  }

  /** Ensure token exists; fetch demo token if missing. */
  async ensureDemoToken(): Promise<void> {
    // Refresh token on load.
    try {
      await firstValueFrom(this.login('demo', 'demo'));
    } catch (e) {
      // Swallow to avoid blocking app if demo auth fails.
      console.error('Auto-auth failed', e);
    }
  }

  private getStoredToken(): string | null {
    return localStorage.getItem(this.tokenKey);
  }
}
