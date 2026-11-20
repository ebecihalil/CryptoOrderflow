export declare function normalizeOrder(order: unknown, all: string[]): string[];
export declare function groupByPriority<T extends { exchange: string; asset: string }>(
  contracts: T[], order: string[], enabled: string[], isHidden?: (contract: T) => boolean,
): Array<{ primary: T; others: T[] }>;
export declare const PRIORITY_SLOTS: number;
export declare function normalizeSlots(saved: unknown, supported: string[], fallback: Array<string | null>,
  legacy?: { order?: unknown; exchanges?: unknown }): Array<string | null>;
export declare function assignSlot(slots: Array<string | null>, index: number, exchange: string | null): Array<string | null>;
export declare function moveSlot(slots: Array<string | null>, index: number, step: -1 | 1): Array<string | null>;
