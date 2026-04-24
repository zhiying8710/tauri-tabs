export class TypedEventBus<Events extends { [K in keyof Events]: unknown }> {
  private readonly listeners = new Map<keyof Events, Set<(payload: Events[keyof Events]) => void>>();

  on<K extends keyof Events>(eventName: K, handler: (payload: Events[K]) => void) {
    const bucket = this.listeners.get(eventName) ?? new Set<(payload: Events[keyof Events]) => void>();
    bucket.add(handler as (payload: Events[keyof Events]) => void);
    this.listeners.set(eventName, bucket);

    return () => {
      bucket.delete(handler as (payload: Events[keyof Events]) => void);
      if (bucket.size === 0) {
        this.listeners.delete(eventName);
      }
    };
  }

  emit<K extends keyof Events>(eventName: K, payload: Events[K]) {
    const bucket = this.listeners.get(eventName);
    if (!bucket) {
      return;
    }

    for (const handler of [...bucket]) {
      handler(payload);
    }
  }

  clear() {
    this.listeners.clear();
  }
}
