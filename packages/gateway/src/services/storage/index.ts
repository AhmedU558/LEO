import { LocalStorageProvider } from './local-provider.js';

export const storageProvider = new LocalStorageProvider();
// Call storageProvider.init() during app startup!
