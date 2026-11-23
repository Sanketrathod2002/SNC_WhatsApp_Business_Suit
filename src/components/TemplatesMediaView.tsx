import { useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Clock,
  CloudDownload,
  Copy,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
  Upload,
  Video,
  X,
  XCircle,
} from 'lucide-react';
import type {
  ConfirmationRequest,
  DriveFileItem,
  MessageTemplate,
  TemplateButton,
} from '../types';
import {
  extractTemplateVariables,
  formatFileSize,
  isSafeHttpsUrl,
} from '../utils/whatsappLogic';
import {
  buildMetaTemplatePayload,
  sanitizeMetaTemplateName,
  validateMetaTemplateInput,
} from '../utils/analyticsLogic';

interface TemplatesMediaViewProps {
  templates: MessageTemplate[];
  driveFiles: DriveFileItem[];
  gatewayConfigured: boolean;
  hasDriveFolder: boolean;
  wabaIdConfigured: boolean;
  onSyncMetaTemplates: () => Promise<{ ok: boolean; count: number; message: string }>;
  onSubmitMetaTemplate: (
    draft: MessageTemplate,
    metaPayload: Record<string, unknown>
  ) => Promise<{ ok: boolean; message: string }>;
  onUseTemplateInBroadcast: (template: MessageTemplate) => void;
  onUploadFileToDrive: (file: File) => Promise<DriveFileItem | null>;
  onRefreshDriveFiles: () => Promise<void>;
  onDeleteDriveFile: (file: DriveFileItem) => void;
  onRequestConfirmation: (req: ConfirmationRequest) => void;
}

export function TemplatesMediaView({
  templates,
  driveFiles,
  gatewayConfigured,
  hasDriveFolder,
  wabaIdConfigured,
  onSyncMetaTemplates,
  onSubmitMetaTemplate,
  onUseTemplateInBroadcast,
  onUploadFileToDrive,
  onRefreshDriveFiles,
  onDeleteDriveFile,
  onRequestConfirmation,
}: TemplatesMediaViewProps) {
  const [activeTab, setActiveTab] = useState<'templates' | 'drive'>('templates');
  const [statusFilter, setStatusFilter] = useState<'APPROVED' | 'PENDING' | 'REJECTED' | 'ALL'>(
    'APPROVED'
  );
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | MessageTemplate['category']>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Sync from Meta state
  const [isSyncingMeta, setIsSyncingMeta] = useState(false);
  const [syncNotice, setSyncNotice] = useState<{ ok: boolean; text: string } | null>(null);

  // Apply for New Template Modal state
  const [showTplModal, setShowTplModal] = useState(false);
  const [tplName, setTplName] = useState('');
  const [tplCategory, setTplCategory] = useState<MessageTemplate['category']>('UTILITY');
  const [tplLanguage, setTplLanguage] = useState('en_US');
  const [tplHeaderType, setTplHeaderType] = useState<MessageTemplate['headerType']>('DOCUMENT');
  const [tplHeaderText, setTplHeaderText] = useState('');
  const [tplBody, setTplBody] = useState('');
  const [tplFooter, setTplFooter] = useState('Parag Sureshrao Chaware - SNC');
  const [sampleValues, setSampleValues] = useState<string[]>([]);
  const [buttons, setButtons] = useState<TemplateButton[]>([]);
  const [tplError, setTplError] = useState('');
  const [isSubmittingMeta, setIsSubmittingMeta] = useState(false);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const detectedVars = useMemo(() => extractTemplateVariables(tplBody), [tplBody]);
  const sanitizedPreviewName = useMemo(() => sanitizeMetaTemplateName(tplName), [tplName]);

  const statusCounts = useMemo(() => {
    let approved = 0;
    let pending = 0;
    let rejected = 0;
    for (const t of templates) {
      if (t.status === 'APPROVED') approved++;
      else if (t.status === 'REJECTED') rejected++;
      else pending++;
    }
    return { approved, pending, rejected, all: templates.length };
  }, [templates]);

  const filteredTemplates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return templates.filter((tpl) => {
      if (statusFilter !== 'ALL' && tpl.status !== statusFilter) return false;
      if (categoryFilter !== 'ALL' && tpl.category !== categoryFilter) return false;
      if (q) {
        const hay = `${tpl.name} ${tpl.body} ${tpl.category} ${tpl.language} ${tpl.status}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [templates, statusFilter, categoryFilter, searchQuery]);

  const renderedPreviewBody = useMemo(() => {
    let preview = tplBody;
    detectedVars.forEach((v, idx) => {
      const sample = (sampleValues[idx] || '').trim() || `[${v}]`;
      const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      preview = preview.replace(new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, 'g'), sample);
    });
    return preview;
  }, [tplBody, detectedVars, sampleValues]);

  const handleInsertNextVariable = () => {
    const nextIdx = detectedVars.length + 1;
    setTplBody((prev) => `${prev}${prev.endsWith(' ') || prev === '' ? '' : ' '}{{${nextIdx}}}`);
    setSampleValues((prev) => {
      const next = [...prev];
      if (!next[nextIdx - 1]) next[nextIdx - 1] = `Sample ${nextIdx}`;
      return next;
    });
  };

  const handleAddButton = () => {
    if (buttons.length >= 3) return;
    setButtons((prev) => [...prev, { type: 'QUICK_REPLY', text: 'Confirm Receipt' }]);
  };

  const handleUpdateButton = (idx: number, patch: Partial<TemplateButton>) => {
    setButtons((prev) => prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  };

  const handleRemoveButton = (idx: number) => {
    setButtons((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSyncMetaClick = async () => {
    setIsSyncingMeta(true);
    setSyncNotice(null);
    try {
      const res = await onSyncMetaTemplates();
      setSyncNotice({ ok: res.ok, text: res.message });
    } finally {
      setIsSyncingMeta(false);
    }
  };

  const handleApplyTemplateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTplError('');

    const validation = validateMetaTemplateInput({
      name: tplName,
      body: tplBody,
      category: tplCategory,
      headerType: tplHeaderType,
      headerText: tplHeaderText,
      exampleValues: sampleValues,
    });

    if (!validation.ok) {
      setTplError(validation.error || 'Please check template fields.');
      return;
    }

    const cleanedExamples = validation.variables.map(
      (v, idx) => (sampleValues[idx] || '').trim() || `Example_${v}`
    );
    const cleanedButtons = buttons.filter((b) => b.text.trim());

    const draft: MessageTemplate = {
      id: `meta-pending-${Date.now()}`,
      name: validation.sanitizedName,
      category: tplCategory,
      language: tplLanguage,
      headerType: tplHeaderType,
      headerText: tplHeaderType === 'TEXT' ? tplHeaderText.trim() : undefined,
      body: tplBody.trim(),
      footer: tplFooter.trim() || undefined,
      variables: validation.variables,
      exampleValues: cleanedExamples,
      buttons: cleanedButtons.length > 0 ? cleanedButtons : undefined,
      status: 'PENDING',
      source: 'meta',
      updatedAt: new Date().toISOString(),
    };

    const metaPayload = buildMetaTemplatePayload({
      name: draft.name,
      category: draft.category,
      language: draft.language,
      headerType: draft.headerType,
      headerText: draft.headerText,
      body: draft.body,
      footer: draft.footer,
      exampleValues: cleanedExamples,
      buttons: cleanedButtons,
    });

    onRequestConfirmation({
      title: `Submit "${draft.name}" to Meta for Approval?`,
      description:
        'SNC WhatsApp will submit this template directly to Meta WhatsApp Cloud API (/{WABA_ID}/message_templates) via your Apps Script Gateway. It will appear in your live list automatically once Meta approves it.',
      details: [
        `Template Name: ${draft.name} (${draft.language})`,
        `Category: ${draft.category} · Header: ${draft.headerType}`,
        `Variables: ${draft.variables.length > 0 ? draft.variables.join(', ') : 'None'}`,
      ],
      confirmLabel: 'Submit to Meta',
      onConfirm: async () => {
        setIsSubmittingMeta(true);
        try {
          const res = await onSubmitMetaTemplate(draft, metaPayload);
          setSyncNotice({ ok: res.ok, text: res.message });
          if (res.ok) {
            setTplName('');
            setTplBody('');
            setShowTplModal(false);
          } else {
            setTplError(res.message);
          }
        } finally {
          setIsSubmittingMeta(false);
        }
      },
    });
  };

  const handleUploadTrigger = async (file: File | undefined) => {
    if (!file) return;
    onRequestConfirmation({
      title: `Upload "${file.name}" to SNC Google Drive?`,
      description:
        'This uploads the file directly into your Google Drive SNC Attachments folder via your Apps Script Gateway and generates a direct Meta-ready HTTPS download URL.',
      details: [`File: ${file.name}`, `Size: ${formatFileSize(file.size)}`],
      confirmLabel: 'Upload to Google Drive',
      onConfirm: async () => {
        setIsUploading(true);
        try {
          await onUploadFileToDrive(file);
        } finally {
          setIsUploading(false);
        }
      },
    });
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefreshDriveFiles();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleCopyUrl = async (item: DriveFileItem) => {
    await navigator.clipboard.writeText(item.downloadUrl);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  return (
    <div className="h-full overflow-y-auto bg-slate-50 px-4 py-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Templates & Media
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              View Approved, Pending, and Rejected WhatsApp templates, apply for new templates, and manage media attachments.
            </p>
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-slate-200/70 p-1">
            <button
              type="button"
              onClick={() => setActiveTab('templates')}
              className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                activeTab === 'templates'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Templates ({statusCounts.all})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('drive')}
              className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                activeTab === 'drive'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Media Library ({driveFiles.length})
            </button>
          </div>
        </div>

        {activeTab === 'templates' ? (
          <div className="space-y-4">
            {/* Status Filter Summary + Primary Actions */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
              <div
                role="tablist"
                aria-label="Filter templates by approval status"
                className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1"
              >
                {(
                  [
                    { id: 'APPROVED', label: 'Approved', count: statusCounts.approved },
                    { id: 'PENDING', label: 'Pending', count: statusCounts.pending },
                    { id: 'REJECTED', label: 'Rejected', count: statusCounts.rejected },
                    { id: 'ALL', label: 'All', count: statusCounts.all },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={statusFilter === item.id}
                    onClick={() => setStatusFilter(item.id)}
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                      statusFilter === item.id
                        ? 'bg-white text-slate-900 shadow-xs font-semibold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <span>{item.label}</span>
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                      ({item.count})
                    </span>
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isSyncingMeta}
                  onClick={() => void handleSyncMetaClick()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
                >
                  <CloudDownload className={`h-3.5 w-3.5 text-[#075E54] ${isSyncingMeta ? 'animate-pulse' : ''}`} />
                  <span>{isSyncingMeta ? 'Syncing...' : 'Sync Templates'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTplError('');
                    setShowTplModal(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#075E54] px-4 py-2 text-xs font-medium text-white hover:bg-[#064c44] whitespace-nowrap"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Apply New Template</span>
                </button>
              </div>
            </div>

            {syncNotice && (
              <div
                role="status"
                className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-xs font-medium ${
                  syncNotice.ok
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                    : 'border-amber-200 bg-amber-50 text-amber-900'
                }`}
              >
                <span>{syncNotice.text}</span>
                <button
                  type="button"
                  onClick={() => setSyncNotice(null)}
                  aria-label="Dismiss template notice"
                  className="rounded p-0.5 hover:bg-black/5"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Category Filter & Search Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Filter templates by category"
                  value={categoryFilter}
                  onChange={(e) =>
                    setCategoryFilter(e.target.value as 'ALL' | MessageTemplate['category'])
                  }
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 focus:border-[#075E54] focus:outline-none"
                >
                  <option value="ALL">All Categories</option>
                  <option value="UTILITY">Utility</option>
                  <option value="MARKETING">Marketing</option>
                  <option value="AUTHENTICATION">Authentication</option>
                </select>
                <span className="text-xs text-slate-500">
                  Status Filter:{' '}
                  <strong className="font-semibold text-slate-800">{statusFilter}</strong>
                  {!wabaIdConfigured || !gatewayConfigured ? ' · Connect Settings to sync' : ''}
                </span>
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search templates..."
                  className="w-60 rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-800 focus:border-[#075E54] focus:outline-none"
                />
              </div>
            </div>

            {/* Templates Grid */}
            {filteredTemplates.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
                <p className="text-sm font-semibold text-slate-900">
                  {templates.length === 0
                    ? 'No templates synced yet'
                    : `No ${statusFilter === 'ALL' ? '' : statusFilter.toLowerCase() + ' '}templates match your filter`}
                </p>
                <p className="mx-auto mt-1.5 max-w-md text-xs text-slate-500">
                  Click <strong className="text-slate-800">Sync Templates</strong> to load all Approved, Pending, and Rejected templates from your WhatsApp Business Account.
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    disabled={isSyncingMeta}
                    onClick={() => void handleSyncMetaClick()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#075E54] px-4 py-2 text-xs font-medium text-white hover:bg-[#064c44]"
                  >
                    <CloudDownload className="h-3.5 w-3.5" />
                    <span>{isSyncingMeta ? 'Syncing...' : 'Sync Templates Now'}</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {filteredTemplates.map((tpl) => (
                  <article
                    key={tpl.id}
                    className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="truncate font-mono text-sm font-semibold text-slate-900">
                            {tpl.name}
                          </h2>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {tpl.category} · {tpl.language} · Header: {tpl.headerType}
                          </p>
                        </div>
                        {tpl.status === 'APPROVED' ? (
                          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-700 whitespace-nowrap">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>APPROVED</span>
                          </span>
                        ) : tpl.status === 'REJECTED' ? (
                          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-red-600 whitespace-nowrap">
                            <XCircle className="h-3.5 w-3.5" />
                            <span>REJECTED</span>
                          </span>
                        ) : (
                          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-amber-700 whitespace-nowrap">
                            <Clock className="h-3.5 w-3.5" />
                            <span>PENDING</span>
                          </span>
                        )}
                      </div>

                      {tpl.headerType === 'TEXT' && tpl.headerText && (
                        <p className="mt-3 text-xs font-semibold text-slate-900">
                          {tpl.headerText}
                        </p>
                      )}

                      <p className="mt-2.5 whitespace-pre-wrap rounded-lg border border-slate-100 bg-slate-50 p-3.5 text-sm leading-relaxed text-slate-800">
                        {tpl.body}
                      </p>

                      {tpl.footer && (
                        <p className="mt-2 text-[11px] text-slate-500">Footer: {tpl.footer}</p>
                      )}

                      {tpl.buttons && tpl.buttons.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-[#075E54]">
                          {tpl.buttons.map((btn, idx) => (
                            <span
                              key={`${tpl.id}-btn-${idx}`}
                              className="rounded border border-slate-200 bg-white px-2 py-0.5 font-medium"
                            >
                              {btn.text}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
                      <span className="truncate">
                        Variables:{' '}
                        <span className="font-mono text-slate-700">
                          {tpl.variables.length > 0 ? tpl.variables.join(', ') : 'None'}
                        </span>
                      </span>
                      {tpl.status === 'APPROVED' ? (
                        <button
                          type="button"
                          onClick={() => onUseTemplateInBroadcast(tpl)}
                          className="inline-flex items-center gap-1 font-semibold text-[#075E54] hover:underline whitespace-nowrap"
                        >
                          <Send className="h-3 w-3" />
                          <span>Use in Broadcast</span>
                        </button>
                      ) : (
                        <span className="font-mono text-[11px] text-slate-400">
                          {tpl.status === 'REJECTED' ? 'Rejected' : 'Pending Review'}
                        </span>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-600">
                {gatewayConfigured && hasDriveFolder
                  ? 'Connected to your cloud attachments library.'
                  : 'Configure your Master Gateway URL in Settings to manage attachments.'}
              </p>
              <div className="flex items-center gap-2">
                {gatewayConfigured && (
                  <button
                    type="button"
                    onClick={() => void handleRefresh()}
                    disabled={isRefreshing}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                    <span>Refresh Drive</span>
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,video/mp4"
                  onChange={(e) => void handleUploadTrigger(e.target.files?.[0])}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={isUploading || !gatewayConfigured}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#075E54] px-4 py-2 text-xs font-medium text-white hover:bg-[#064c44] disabled:opacity-50 whitespace-nowrap"
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>{isUploading ? 'Uploading...' : 'Upload to Google Drive'}</span>
                </button>
              </div>
            </div>

            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              {driveFiles.length === 0 ? (
                <div className="p-10 text-center">
                  <p className="text-sm font-semibold text-slate-900">
                    No Google Drive attachments loaded yet
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Click Refresh Drive to list files from your Google Drive folder, or upload a new PDF/Image attachment.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                        <th className="px-5 py-3">File Name</th>
                        <th className="px-4 py-3">Type</th>
                        <th className="px-4 py-3 text-right">Size</th>
                        <th className="px-4 py-3">Storage</th>
                        <th className="px-5 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {driveFiles.map((file) => (
                        <tr key={file.id} className="hover:bg-slate-50/70">
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2.5">
                              {file.kind === 'image' ? (
                                <ImageIcon className="h-4 w-4 shrink-0 text-[#075E54]" />
                              ) : file.kind === 'video' ? (
                                <Video className="h-4 w-4 shrink-0 text-[#075E54]" />
                              ) : (
                                <FileText className="h-4 w-4 shrink-0 text-[#075E54]" />
                              )}
                              <span className="font-medium text-slate-900">{file.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs uppercase text-slate-600">{file.kind}</td>
                          <td className="px-4 py-3 text-right font-mono text-xs text-slate-600 tabular-nums">
                            {formatFileSize(file.sizeBytes)}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-600">Google Drive</td>
                          <td className="px-5 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => void handleCopyUrl(file)}
                                aria-label={`Copy download link for ${file.name}`}
                                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                              >
                                {copiedId === file.id ? (
                                  <Check className="h-4 w-4 text-emerald-600" />
                                ) : (
                                  <Copy className="h-4 w-4" />
                                )}
                              </button>
                              {isSafeHttpsUrl(file.webViewLink) && (
                                <a
                                  href={file.webViewLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-label={`Open ${file.name} in Google Drive`}
                                  className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                                >
                                  <ExternalLink className="h-4 w-4" />
                                </a>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  onRequestConfirmation({
                                    title: `Delete "${file.name}"?`,
                                    description:
                                      'This moves the file to trash in your Google Drive SNC Attachments folder.',
                                    confirmLabel: 'Delete File',
                                    tone: 'danger',
                                    onConfirm: () => onDeleteDriveFile(file),
                                  })
                                }
                                aria-label={`Delete ${file.name}`}
                                className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      {/* Apply for New Meta WhatsApp Template Modal */}
      {showTplModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tpl-modal-title"
        >
          <form
            onSubmit={handleApplyTemplateSubmit}
            className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h2 id="tpl-modal-title" className="text-base font-semibold text-slate-900">
                  Apply for New Meta WhatsApp Template
                </h2>
                <p className="text-xs text-slate-500">
                  Submits directly to Meta WhatsApp Cloud API (v25.0) for approval.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowTplModal(false)}
                aria-label="Close template modal"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid flex-1 grid-cols-1 gap-6 overflow-y-auto p-6 lg:grid-cols-12">
              {/* Left Column: Meta Template Form */}
              <div className="space-y-4 lg:col-span-7">
                <div>
                  <label htmlFor="tpl-name" className="block text-xs font-medium text-slate-700">
                    Template Name (lowercase snake_case)
                  </label>
                  <input
                    id="tpl-name"
                    type="text"
                    required
                    value={tplName}
                    onChange={(e) => setTplName(e.target.value)}
                    placeholder="e.g. gst_payment_receipt_v2"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm focus:border-[#075E54] focus:outline-none"
                  />
                  {tplName.trim() && (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Meta Identifier:{' '}
                      <span className="font-mono font-semibold text-slate-800">
                        {sanitizedPreviewName || 'invalid'}
                      </span>
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label htmlFor="tpl-cat" className="block text-xs font-medium text-slate-700">
                      Category
                    </label>
                    <select
                      id="tpl-cat"
                      value={tplCategory}
                      onChange={(e) =>
                        setTplCategory(e.target.value as MessageTemplate['category'])
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-[#075E54] focus:outline-none"
                    >
                      <option value="UTILITY">Utility</option>
                      <option value="MARKETING">Marketing</option>
                      <option value="AUTHENTICATION">Authentication</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="tpl-lang" className="block text-xs font-medium text-slate-700">
                      Language
                    </label>
                    <select
                      id="tpl-lang"
                      value={tplLanguage}
                      onChange={(e) => setTplLanguage(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-[#075E54] focus:outline-none"
                    >
                      <option value="en_US">English (en_US)</option>
                      <option value="en">English (en)</option>
                      <option value="hi">Hindi (hi)</option>
                      <option value="mr">Marathi (mr)</option>
                      <option value="gu">Gujarati (gu)</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="tpl-header" className="block text-xs font-medium text-slate-700">
                      Header Type
                    </label>
                    <select
                      id="tpl-header"
                      value={tplHeaderType}
                      onChange={(e) =>
                        setTplHeaderType(e.target.value as MessageTemplate['headerType'])
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-[#075E54] focus:outline-none"
                    >
                      <option value="NONE">None</option>
                      <option value="TEXT">Text Header</option>
                      <option value="DOCUMENT">Document (PDF)</option>
                      <option value="IMAGE">Image</option>
                      <option value="VIDEO">Video</option>
                    </select>
                  </div>
                </div>

                {tplHeaderType === 'TEXT' && (
                  <div>
                    <label htmlFor="tpl-header-text" className="block text-xs font-medium text-slate-700">
                      Header Text (max 60 chars)
                    </label>
                    <input
                      id="tpl-header-text"
                      type="text"
                      maxLength={60}
                      value={tplHeaderText}
                      onChange={(e) => setTplHeaderText(e.target.value)}
                      placeholder="e.g. SNC Payment Confirmation"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#075E54] focus:outline-none"
                    />
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between">
                    <label htmlFor="tpl-body" className="block text-xs font-medium text-slate-700">
                      Message Body
                    </label>
                    <button
                      type="button"
                      onClick={handleInsertNextVariable}
                      className="text-xs font-semibold text-[#075E54] hover:underline"
                    >
                      + Insert &#123;&#123;{detectedVars.length + 1}&#125;&#125;
                    </button>
                  </div>
                  <textarea
                    id="tpl-body"
                    rows={4}
                    required
                    value={tplBody}
                    onChange={(e) => setTplBody(e.target.value)}
                    placeholder="Hello {{1}}, your receipt {{2}} is ready."
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#075E54] focus:outline-none"
                  />
                </div>

                {/* Required Meta Sample Values */}
                {detectedVars.length > 0 && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                    <p className="text-xs font-semibold text-slate-800">
                      Sample Values for Meta Review ({detectedVars.length})
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      Meta requires realistic example text for each placeholder before approving your template.
                    </p>
                    <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {detectedVars.map((varName, idx) => (
                        <div key={`sample-${varName}-${idx}`}>
                          <label className="block font-mono text-[11px] text-slate-600">
                            &#123;&#123;{varName}&#125;&#125; → Meta &#123;&#123;{idx + 1}&#125;&#125;
                          </label>
                          <input
                            type="text"
                            value={sampleValues[idx] || ''}
                            onChange={(e) =>
                              setSampleValues((prev) => {
                                const next = [...prev];
                                next[idx] = e.target.value;
                                return next;
                              })
                            }
                            placeholder={`Example for ${varName}`}
                            className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:border-[#075E54] focus:outline-none"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label htmlFor="tpl-footer" className="block text-xs font-medium text-slate-700">
                    Footer Text (optional, max 60 chars)
                  </label>
                  <input
                    id="tpl-footer"
                    type="text"
                    maxLength={60}
                    value={tplFooter}
                    onChange={(e) => setTplFooter(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#075E54] focus:outline-none"
                  />
                </div>

                {/* Optional Interactive Buttons */}
                <div className="rounded-lg border border-slate-200 p-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-800">
                      Interactive Buttons (Optional, max 3)
                    </span>
                    <button
                      type="button"
                      disabled={buttons.length >= 3}
                      onClick={handleAddButton}
                      className="text-xs font-semibold text-[#075E54] hover:underline disabled:opacity-40"
                    >
                      + Add Button
                    </button>
                  </div>
                  {buttons.length > 0 && (
                    <div className="mt-2.5 space-y-2">
                      {buttons.map((btn, idx) => (
                        <div key={`new-btn-${idx}`} className="flex flex-wrap items-center gap-2">
                          <select
                            value={btn.type}
                            onChange={(e) =>
                              handleUpdateButton(idx, {
                                type: e.target.value as TemplateButton['type'],
                              })
                            }
                            className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
                          >
                            <option value="QUICK_REPLY">Quick Reply</option>
                            <option value="URL">Website URL</option>
                            <option value="PHONE_NUMBER">Call Phone</option>
                          </select>
                          <input
                            type="text"
                            maxLength={25}
                            value={btn.text}
                            onChange={(e) => handleUpdateButton(idx, { text: e.target.value })}
                            placeholder="Button label"
                            className="min-w-[130px] flex-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs"
                          />
                          {btn.type === 'URL' && (
                            <input
                              type="url"
                              value={btn.url || ''}
                              onChange={(e) => handleUpdateButton(idx, { url: e.target.value })}
                              placeholder="https://..."
                              className="min-w-[150px] flex-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs"
                            />
                          )}
                          {btn.type === 'PHONE_NUMBER' && (
                            <input
                              type="text"
                              value={btn.phoneNumber || ''}
                              onChange={(e) =>
                                handleUpdateButton(idx, { phoneNumber: e.target.value })
                              }
                              placeholder="+919800000000"
                              className="w-36 rounded-md border border-slate-200 px-2.5 py-1.5 font-mono text-xs"
                            />
                          )}
                          <button
                            type="button"
                            onClick={() => handleRemoveButton(idx)}
                            aria-label="Remove button"
                            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {tplError && (
                  <p className="text-xs font-medium text-red-600" role="alert">
                    {tplError}
                  </p>
                )}
              </div>

              {/* Right Column: Live WhatsApp Business Preview */}
              <div className="flex flex-col lg:col-span-5">
                <p className="text-xs font-semibold text-slate-700">
                  Live WhatsApp Preview
                </p>
                <div className="mt-2 flex-1 rounded-xl border border-slate-200 bg-[#EFEAE2] p-4">
                  <div className="mx-auto max-w-xs overflow-hidden rounded-lg bg-white shadow-xs">
                    {tplHeaderType === 'DOCUMENT' && (
                      <div className="flex items-center gap-2.5 border-b border-slate-100 bg-slate-50 px-3.5 py-3 text-xs font-medium text-slate-700">
                        <FileText className="h-5 w-5 shrink-0 text-red-600" />
                        <span className="truncate">Receipt_Sample.pdf</span>
                      </div>
                    )}
                    {tplHeaderType === 'IMAGE' && (
                      <div className="flex h-28 items-center justify-center bg-slate-100 text-xs text-slate-500">
                        <ImageIcon className="mr-1.5 h-4 w-4" />
                        <span>Image Header Attachment</span>
                      </div>
                    )}
                    {tplHeaderType === 'VIDEO' && (
                      <div className="flex h-28 items-center justify-center bg-slate-900 text-xs text-slate-200">
                        <Video className="mr-1.5 h-4 w-4" />
                        <span>Video Header Attachment</span>
                      </div>
                    )}
                    {tplHeaderType === 'TEXT' && tplHeaderText.trim() && (
                      <div className="px-3.5 pt-3 text-xs font-bold text-slate-900">
                        {tplHeaderText}
                      </div>
                    )}

                    <div className="px-3.5 py-2.5">
                      <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-900">
                        {renderedPreviewBody || 'Start typing your template message...'}
                      </p>
                      <div className="mt-2 flex items-end justify-between gap-2">
                        <span className="text-[10px] text-slate-400">
                          {tplFooter.trim() || ''}
                        </span>
                        <span className="font-mono text-[10px] text-slate-400 tabular-nums">
                          10:42 AM
                        </span>
                      </div>
                    </div>

                    {buttons.filter((b) => b.text.trim()).length > 0 && (
                      <div className="divide-y divide-slate-100 border-t border-slate-100">
                        {buttons
                          .filter((b) => b.text.trim())
                          .map((btn, idx) => (
                            <div
                              key={`prev-btn-${idx}`}
                              className="py-2 text-center text-xs font-semibold text-[#008069]"
                            >
                              {btn.text}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>

                  <p className="mt-4 text-center text-[11px] text-slate-600">
                    Category: <span className="font-semibold">{tplCategory}</span> · Language:{' '}
                    <span className="font-mono">{tplLanguage}</span>
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-3.5">
              <p className="text-[11px] text-slate-500">
                Submits directly to Meta Cloud API. Only APPROVED templates appear in live dispatch lists.
              </p>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowTplModal(false)}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingMeta}
                  className="rounded-lg bg-[#075E54] px-4 py-2 text-xs font-medium text-white hover:bg-[#064c44] disabled:opacity-50 whitespace-nowrap"
                >
                  {isSubmittingMeta ? 'Submitting...' : 'Apply & Submit to Meta'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
