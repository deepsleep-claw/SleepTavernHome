import { normalizeBackupFrequency } from './backup-frequency';

export type BackupLifecycle = {
  available(): boolean;
  subscribe(listener: () => void): () => void;
};

function browserLifecycle(): BackupLifecycle {
  return {
    available: () =>
      (typeof document === 'undefined' || document.visibilityState !== 'hidden') &&
      (typeof navigator === 'undefined' || navigator.onLine !== false),
    subscribe(listener) {
      if (typeof window === 'undefined') return () => {};
      document.addEventListener('visibilitychange', listener);
      window.addEventListener('pageshow', listener);
      window.addEventListener('online', listener);
      window.addEventListener('offline', listener);
      return () => {
        document.removeEventListener('visibilitychange', listener);
        window.removeEventListener('pageshow', listener);
        window.removeEventListener('online', listener);
        window.removeEventListener('offline', listener);
      };
    },
  };
}

/** 检查结束后安排下一次；页面恢复只重新计时，不追赶错过的周期。 */
export class SessionBackupScheduler {
  private timer?: ReturnType<typeof setTimeout>;
  private checking = false;
  private disposed = false;
  private generation = 0;
  private seconds = 120;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly check: () => Promise<void>,
    seconds = 120,
    private readonly lifecycle = browserLifecycle(),
    private readonly onError: (error: unknown) => void = () => {},
  ) {
    this.unsubscribe = lifecycle.subscribe(() => this.restart());
    this.setFrequency(seconds);
  }

  setFrequency(seconds: number): void {
    const next = normalizeBackupFrequency(seconds);
    if (next === this.seconds && (this.timer || this.checking)) return;
    this.seconds = next;
    this.restart();
  }

  private restart(): void {
    this.generation += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.disposed && !this.checking && this.lifecycle.available()) {
      const generation = this.generation;
      this.timer = setTimeout(() => {
        if (generation !== this.generation || this.disposed) return;
        this.timer = undefined;
        void this.tick();
      }, this.seconds * 1000);
    }
  }

  private async tick(): Promise<void> {
    if (this.checking || this.disposed || !this.lifecycle.available()) return;
    this.checking = true;
    try {
      await this.check();
    } catch (error) {
      this.onError(error);
    } finally {
      this.checking = false;
      this.restart();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.restart();
  }
}
