import { isDesktopApp } from './appApi.ts';

export interface UpdateStatus {
  checking: boolean;
  updateAvailable: boolean;
  version?: string;
  notes?: string;
  error?: string;
  downloadProgress?: number; // 0 - 100
  downloading?: boolean;
  readyToRestart?: boolean;
}

/**
 * Checks for new releases against the public GitHub Release manifest.
 * Only executes when running inside the Tauri native desktop shell.
 */
export async function checkDesktopUpdate(): Promise<{
  available: boolean;
  version?: string;
  notes?: string;
  downloadAndInstall?: (onProgress?: (percent: number) => void) => Promise<void>;
  error?: string;
}> {
  if (!isDesktopApp()) {
    return { available: false, error: 'In-app updates are only available in the desktop app.' };
  }

  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();

    if (!update) {
      return { available: false };
    }

    return {
      available: true,
      version: update.version,
      notes: update.body,
      downloadAndInstall: async (onProgress?: (percent: number) => void) => {
        let downloaded = 0;
        let contentLength = 0;

        await update.downloadAndInstall((event) => {
          switch (event.event) {
            case 'Started':
              contentLength = event.data.contentLength ?? 0;
              onProgress?.(0);
              break;
            case 'Progress':
              downloaded += event.data.chunkLength;
              if (contentLength > 0) {
                const pct = Math.min(100, Math.round((downloaded / contentLength) * 100));
                onProgress?.(pct);
              }
              break;
            case 'Finished':
              onProgress?.(100);
              break;
          }
        });
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { available: false, error: message };
  }
}
