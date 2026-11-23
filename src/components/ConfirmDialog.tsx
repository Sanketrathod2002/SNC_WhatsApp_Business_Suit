import { useState } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import type { ConfirmationRequest } from '../types';

interface ConfirmDialogProps {
  request: ConfirmationRequest | null;
  onClose: () => void;
}

export function ConfirmDialog({ request, onClose }: ConfirmDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!request) return null;

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      await request.onConfirm();
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const isDanger = request.tone === 'danger';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div
              className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                isDanger ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'
              }`}
            >
              {isDanger ? <AlertTriangle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
            </div>
            <div>
              <h2 id="confirm-dialog-title" className="text-base font-semibold text-slate-900">
                {request.title}
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">{request.description}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close confirmation dialog"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {request.details && request.details.length > 0 && (
          <ul className="mt-4 space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3 text-xs text-slate-700">
            {request.details.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-60 ${
              isDanger
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-[#075E54] hover:bg-[#064c44]'
            }`}
          >
            {isSubmitting ? 'Processing...' : request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
