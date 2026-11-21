import { useState } from 'react';
import { ArrowDownCircle, RefreshCw, X, Sparkles, CheckCircle2 } from 'lucide-react';

interface UpdateNotificationModalProps {
  version: string;
  notes?: string;
  onInstall: (onProgress?: (percent: number) => void) => Promise<void>;
  onDismiss: () => void;
}

export function UpdateNotificationModal({
  version,
  notes,
  onInstall,
  onDismiss,
}: UpdateNotificationModalProps) {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStartUpdate = async () => {
    setDownloading(true);
    setProgress(0);
    setError(null);
    try {
      await onInstall((pct) => setProgress(pct));
      setReady(true);
      setDownloading(false);
    } catch (err) {
      setDownloading(false);
      setError(err instanceof Error ? err.message : 'Failed to download update.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Software Update"
    >
      <div className="w-full max-w-lg rounded-xl border border-sky-500/50 bg-[#0A0E17] shadow-2xl overflow-hidden font-sans text-slate-100">
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-sky-950/80 to-slate-900 border-b border-sky-500/30 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-sky-500/20 text-sky-400 border border-sky-400/30">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm tracking-wide text-white">NEW UPDATE AVAILABLE</h3>
              <p className="text-xs text-sky-300 font-mono">Church Audio Intelligence v{version}</p>
            </div>
          </div>
          {!downloading && (
            <button
              type="button"
              onClick={onDismiss}
              className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition"
              title="Later"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 text-xs">
          {notes ? (
            <div className="p-3 rounded-lg border border-slate-800 bg-[#06090F] max-h-48 overflow-y-auto space-y-1.5 text-slate-300">
              <p className="font-semibold text-slate-100 uppercase tracking-wider text-[11px]">
                Release Highlights:
              </p>
              <div className="whitespace-pre-line text-slate-300 font-sans leading-relaxed">
                {notes}
              </div>
            </div>
          ) : (
            <p className="text-slate-300">
              A new verified release is ready with DSP audio optimizations, driver stability improvements, and bug fixes.
            </p>
          )}

          {error && (
            <div className="p-3 rounded-md bg-red-950/80 border border-red-500/50 text-red-200">
              {error}
            </div>
          )}

          {downloading && (
            <div className="space-y-2">
              <div className="flex justify-between font-mono text-[11px] text-sky-300">
                <span>Downloading verified update...</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden border border-slate-700">
                <div
                  className="h-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {ready && (
            <div className="p-3 rounded-lg border border-emerald-500/40 bg-emerald-950/40 text-emerald-200 flex items-center gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <div>
                <p className="font-semibold text-emerald-100">Update Installed Successfully!</p>
                <p className="text-[11px] text-emerald-300">
                  Restart the app whenever you are ready to use version {version}.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-slate-900/60 border-t border-slate-800 flex items-center justify-between gap-3">
          <button
            type="button"
            disabled={downloading}
            onClick={onDismiss}
            className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 text-xs font-medium disabled:opacity-50 transition"
          >
            {ready ? 'Close' : 'Remind Me Later'}
          </button>

          {!ready ? (
            <button
              type="button"
              disabled={downloading}
              onClick={handleStartUpdate}
              className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs flex items-center gap-2 shadow-lg shadow-sky-600/20 disabled:opacity-50 transition cursor-pointer"
            >
              {downloading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Downloading...
                </>
              ) : (
                <>
                  <ArrowDownCircle className="w-4 h-4" />
                  Download &amp; Install
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Restart Now
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
