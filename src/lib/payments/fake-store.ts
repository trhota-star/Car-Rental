// Storage for the LOCAL fake payment provider. In-memory for unit tests and one-off scripts;
// PostgreSQL (fake_payment_provider_* tables) for the app, so state survives server restarts.
import type { Pool, PoolClient } from "pg";
import type { DepositHold, Payment, PaymentEvent } from "./types";

export type FakeObject = (Payment & { kind: "payment" }) | (DepositHold & { kind: "hold" });

export interface FakeProviderStore {
  /**
   * Claim `scope:key` for `newId`. Returns the id that owns the key: `newId` if this call claimed it,
   * otherwise the id stored by an earlier (or concurrent) call.
   */
  claimIdempotency(scopedKey: string, newId: string): Promise<string>;
  insert(obj: FakeObject): Promise<void>;
  get(id: string): Promise<FakeObject | null>;
  /** Atomically read-modify-write one object. `fn` may throw to abort (nothing is written). */
  mutate(id: string, fn: (cur: FakeObject) => FakeObject): Promise<{ before: FakeObject; after: FakeObject } | null>;
  appendEvent(event: PaymentEvent): Promise<void>;
  getEvent(id: string): Promise<PaymentEvent | null>;
  listEvents(): Promise<PaymentEvent[]>;
}

const clone = <T>(v: T): T => structuredClone(v);

export class MemoryFakeProviderStore implements FakeProviderStore {
  private objects = new Map<string, FakeObject>();
  private idem = new Map<string, string>();
  private events: PaymentEvent[] = [];

  async claimIdempotency(scopedKey: string, newId: string) {
    const cur = this.idem.get(scopedKey);
    if (cur) return cur;
    this.idem.set(scopedKey, newId);
    return newId;
  }
  async insert(obj: FakeObject) {
    this.objects.set(obj.id, clone(obj));
  }
  async get(id: string) {
    const o = this.objects.get(id);
    return o ? clone(o) : null;
  }
  async mutate(id: string, fn: (cur: FakeObject) => FakeObject) {
    const cur = this.objects.get(id);
    if (!cur) return null;
    const after = fn(clone(cur));
    this.objects.set(id, clone(after));
    return { before: clone(cur), after: clone(after) };
  }
  async appendEvent(event: PaymentEvent) {
    this.events.push(clone(event));
  }
  async getEvent(id: string) {
    const e = this.events.find((x) => x.id === id);
    return e ? clone(e) : null;
  }
  async listEvents() {
    return this.events.map(clone);
  }
}

/** Durable store. Uses the app's pool; the tables come from drizzle/0003. */
export class PgFakeProviderStore implements FakeProviderStore {
  constructor(private readonly pool: Pool) {}

  async claimIdempotency(scopedKey: string, newId: string) {
    const ins = await this.pool.query<{ object_id: string }>(
      `INSERT INTO fake_payment_provider_idempotency (key, object_id) VALUES ($1, $2)
       ON CONFLICT (key) DO NOTHING RETURNING object_id`,
      [scopedKey, newId],
    );
    if (ins.rows[0]) return ins.rows[0].object_id;
    const { rows } = await this.pool.query<{ object_id: string }>(
      "SELECT object_id FROM fake_payment_provider_idempotency WHERE key = $1",
      [scopedKey],
    );
    return rows[0].object_id;
  }

  async insert(obj: FakeObject) {
    await this.pool.query("INSERT INTO fake_payment_provider_objects (id, kind, data) VALUES ($1, $2, $3)", [
      obj.id,
      obj.kind,
      JSON.stringify(obj),
    ]);
  }

  async get(id: string) {
    const { rows } = await this.pool.query<{ data: FakeObject }>(
      "SELECT data FROM fake_payment_provider_objects WHERE id = $1",
      [id],
    );
    return rows[0]?.data ?? null;
  }

  async mutate(id: string, fn: (cur: FakeObject) => FakeObject) {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{ data: FakeObject }>(
        "SELECT data FROM fake_payment_provider_objects WHERE id = $1 FOR UPDATE",
        [id],
      );
      if (!rows[0]) {
        await client.query("ROLLBACK");
        return null;
      }
      const before = rows[0].data;
      const after = fn(structuredClone(before));
      await client.query("UPDATE fake_payment_provider_objects SET data = $2, updated_at = now() WHERE id = $1", [
        id,
        JSON.stringify(after),
      ]);
      await client.query("COMMIT");
      return { before, after };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async appendEvent(event: PaymentEvent) {
    await this.pool.query(
      "INSERT INTO fake_payment_provider_events (id, data) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [event.id, JSON.stringify(event)],
    );
  }

  async getEvent(id: string) {
    const { rows } = await this.pool.query<{ data: PaymentEvent }>(
      "SELECT data FROM fake_payment_provider_events WHERE id = $1",
      [id],
    );
    return rows[0]?.data ?? null;
  }

  async listEvents() {
    const { rows } = await this.pool.query<{ data: PaymentEvent }>(
      "SELECT data FROM fake_payment_provider_events ORDER BY seq",
    );
    return rows.map((r) => r.data);
  }
}
