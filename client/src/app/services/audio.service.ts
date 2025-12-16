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
   * Play a minimalist notification sound with echo effect
   */
  playToastSound(type: 'success' | 'error' | 'info' = 'success'): void {
    try {
      const ctx = this.ensureAudioContext();
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      // Create echo/delay effect
      const delay = ctx.createDelay();
      const delayGain = ctx.createGain();
      const dryGain = ctx.createGain();

      osc.type = 'sine';

      // Simple, clean frequencies
      const frequencies = {
        success: 659, 
        error: 329,    
        info: 440      
      };

      const durations = {
        success: 0.3,
        error: 0.3,
        info: 0.3
      };

      osc.frequency.value = frequencies[type];
      const duration = durations[type];

      // Echo/delay settings
      delay.delayTime.value = 0.15;  // 150ms echo delay
      delayGain.gain.value = 0.4;    // Echo is 40% of original volume

      // Minimalist envelope: smooth rise, sustain, smooth fade
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.05, now + 0.05);              // Quick attack
      gain.gain.setValueAtTime(0.05, now + duration - 0.15);             // Brief sustain
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);      // Long smooth fade

      // Route: osc -> gain -> split (dry to destination + delay to echo)
      osc.connect(gain);
      gain.connect(dryGain);
      gain.connect(delay);
      dryGain.connect(ctx.destination);
      delay.connect(delayGain);
      delayGain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + duration + 0.15);  // Stop after echo delay completes

      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
        delay.disconnect();
        delayGain.disconnect();
        dryGain.disconnect();
      };
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
