import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class AudioService {
  private audioContext: AudioContext | null = null;

  /**
   * Initialize audio context
   */
  private ensureAudioContext(): AudioContext {
    if (!this.audioContext) {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.audioContext = audioContext;
    }
    return this.audioContext;
  }

  /**
   * Play notification sound (beep)
   */
  playToastSound(type: 'success' | 'error' | 'info' = 'success'): void {
    try {
      const ctx = this.ensureAudioContext();

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      const frequencies = {
        success: 800,
        error: 300,
        info: 600
      };

      const durations = {
        success: 0.1,
        error: 0.2,
        info: 0.15
      };

      osc.frequency.value = frequencies[type];
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + durations[type]);

      osc.start(now);
      osc.stop(now + durations[type]);
    } catch (error) {
      console.warn('Audio playback not available:', error);
    }
  }

  /**
   * Stop all audio
   */
  stop(): void {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}
