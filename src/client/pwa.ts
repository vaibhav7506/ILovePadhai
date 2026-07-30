export const OFFLINE_CACHE = 'examforge-explicit-downloads-v1';
export const offlineLibraryKey = 'examforge.offline_library';
export const offlineResultsKey = 'examforge.offline_results';

export interface DownloadedItem {
  id: string;
  kind: 'note' | 'practice';
  title: string;
  detail: string;
  downloadUrl: string;
  version: string;
  downloadedAt: string;
}

export function readDownloadedItems(): DownloadedItem[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(offlineLibraryKey) ?? '[]');
    return Array.isArray(parsed) ? (parsed as DownloadedItem[]) : [];
  } catch {
    return [];
  }
}

export function writeDownloadedItems(items: DownloadedItem[]): void {
  localStorage.setItem(offlineLibraryKey, JSON.stringify(items));
}

export async function clearOfflineStorage(): Promise<void> {
  await caches.delete(OFFLINE_CACHE);
  localStorage.removeItem(offlineLibraryKey);
  localStorage.removeItem(offlineResultsKey);
}
