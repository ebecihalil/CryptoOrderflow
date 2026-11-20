export declare const CHART_SETTINGS_KEY: string;
export declare function chartSettingsSnapshot(): Record<string, unknown>;
export declare function getChartSetting(field: string): unknown;
export declare function setChartSetting(field: string, value: unknown): void;
export declare function replaceChartSettings(next: unknown): void;
export declare function clearChartSettings(): void;
export declare function subscribeChartSettings(listener: () => void): () => void;
export declare function onChartSettingsChange(listener: (state: Record<string, unknown>) => void): () => void;
