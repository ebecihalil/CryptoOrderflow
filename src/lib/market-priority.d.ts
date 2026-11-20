export declare function normalizeOrder(order: unknown, all: string[]): string[];
export declare function groupByPriority<T extends { exchange: string; asset: string }>(
  contracts: T[], order: string[], enabled: string[], isHidden?: (contract: T) => boolean,
): Array<{ primary: T; others: T[] }>;
