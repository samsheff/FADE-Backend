export class RateLimiter {
  private lastCall = 0;

  constructor(private readonly intervalMs: number) {}

  async wait(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastCall;
    if (elapsed < this.intervalMs) {
      await new Promise((resolve) => setTimeout(resolve, this.intervalMs - elapsed));
    }
    this.lastCall = Date.now();
  }
}
