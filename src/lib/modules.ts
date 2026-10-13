export type ModuleInfo = {
  title: string;
  mark: string;
  path: string;
  description: string;
};

export const MODULES: ModuleInfo[] = [
  { title: 'Long Short Account Ratio', mark: 'LS', path: '/long-short-account-ratio', description: 'OI-weighted account positioning across perpetual markets.' },
  { title: 'Funding Rate', mark: 'FR', path: '/funding-rate', description: 'Funding dynamics across perpetual venues.' },
  { title: 'Open Interest', mark: 'OI', path: '/open-interest', description: 'Open interest changes across markets.' },
  { title: 'Liquidations', mark: 'LI', path: '/liquidations', description: 'Liquidation activity across perpetual markets.' },
  { title: 'CVD', mark: 'CV', path: '/cvd', description: 'Cumulative volume delta across markets.' },
  { title: 'Super Charts (Indicators)', mark: 'SC', path: '/super-charts', description: 'Charting tools and technical indicators.' },
];

export const HOME_MODULES = MODULES.filter(
  (module) => module.path !== '/cvd' && module.path !== '/liquidations',
);
