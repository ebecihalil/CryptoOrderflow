/* eslint-disable @typescript-eslint/no-explicit-any */
export declare const LAST_CHART_CONTRACT_KEY: string;
export declare function validChartContract(value: any): boolean;
export declare function coinPreferenceKey(asset: string, field: string): string;
export declare function chartViewKey(asset: string, exchange: string, symbol: string, timeframe: string): string;
export declare function readChartPreference(key: string, fallback: any, validate?: (value: any) => boolean): any;
export declare function writeChartPreference(key: string, value: unknown): void;
export declare function clearChartPreferences(): void;
export declare function validShape(value: unknown, fallback: unknown): boolean;
export declare function validChartView(view: any): boolean;
export declare function shiftedChartRange(view: any, newAnchorLogical: number): any;
