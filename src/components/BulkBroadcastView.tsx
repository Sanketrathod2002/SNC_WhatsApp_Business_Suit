import { useMemo, useRef, useState } from 'react';
import {
  CheckCheck,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  Image as ImageIcon,
  Paperclip,
  Pause,
  Play,
  Send,
  ShieldAlert,
  Square,
  Upload,
} from 'lucide-react';
import type {
  Attachment,
  Campaign,
  ChatMessage,
  ConfirmationRequest,
  Contact,
  DriveFileItem,
  MessageTemplate,
} from '../types';
import {
  buildBulkRecipients,
  formatFileSize,
  formatPhoneDisplay,
  inferAttachmentKind,
  isSafeHttpsUrl,
  parseApprovedTemplateSchema,
  parseCsvContacts,
  renderApprovedTemplatePreview,
  renderMessageTemplate,
  resolveRecipientAttachment,
  SAMPLE_WATI_BULK_CSV,
} from '../utils/whatsappLogic';

export interface BulkDispatchControl {
  paused: boolean;
  stopped: boolean;
}

export interface BulkExecutionRowResult {
  name: string;
  phone: string;
  status: 'sent' | 'failed' | 'skipped';
  error?: string;
  timestamp: string;
}

export interface BulkTemplateParamResolution {
  bodyParams: string[];
  headerParams: string[];
  buttonParams: string[];
  headerType?: 'NONE' | 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'VIDEO';
  language?: string;
}

interface BulkBroadcastViewProps {
  contacts: Contact[];
  messages: ChatMessage[];
  templates: MessageTemplate[];
  campaigns: Campaign[];
  driveFiles: DriveFileItem[];
  defaultCountryCode: string;
  rateLimitMs: number;
  dailyQuotaCap: number;
  gatewayConfigured: boolean;
  onImportContacts: (newContacts: Contact[]) => void;
  onImportFromGoogleSheet: (sheetUrlOrId: string) => Promise<number>;
  onUploadFileToDrive: (file: File) => Promise<DriveFileItem | null>;
  onSendTestMessage: (params: {
    contact: Contact;
    body: string;
    attachment?: Attachment;
    templateName?: string;
    templateLanguage?: string;
    templateParams?: string[];
    templateHeaderType?: 'NONE' | 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'VIDEO';
    templateHeaderParams?: string[];
    templateButtonParams?: string[];
  }) => Promise<void>;
  onQueueBulkCampaign: (params: {
    campaignName: string;
    recipients: Contact[];
    messageTemplate: string;
    templateName: string;
    attachmentMode: 'none' | 'shared' | 'per-contact';
    sharedAttachment: Attachment | null;
  }) => Promise<{ ok: boolean; queuedCount: number; message: string }>;
  onRunBulkCampaign: (params: {
    campaignName: string;
    recipients: Contact[];
    messageTemplate: string;
    templateName: string;
    attachmentMode: 'none' | 'shared' | 'per-contact';
    sharedAttachment: Attachment | null;
    delayMs: number;
    controlRef: { current: BulkDispatchControl };
    resolveTemplateParams?: (contact: Contact) => BulkTemplateParamResolution;
    onProgress: (stats: {
      processed: number;
      sent: number;
      failed: number;
      rowResult?: BulkExecutionRowResult;
    }) => void;
  }) => Promise<Campaign>;
  onRequestConfirmation: (req: ConfirmationRequest) => void;
}

const MERGE_FIELDS = [
  { token: '{{name}}', label: 'Full Name' },
  { token: '{{first_name}}', label: 'First Name' },
  { token: '{{company}}', label: 'Company' },
  { token: '{{custom1}}', label: 'Order / Ref' },
  { token: '{{custom2}}', label: 'City / Custom 2' },
];

export function BulkBroadcastView({
  contacts,
  messages,
  templates,
  campaigns,
  driveFiles,
  defaultCountryCode,
  rateLimitMs,
  dailyQuotaCap,
  gatewayConfigured,
  onImportContacts,
  onImportFromGoogleSheet,
  onUploadFileToDrive,
  onSendTestMessage,
  onQueueBulkCampaign,
  onRunBulkCampaign,
  onRequestConfirmation,
}: BulkBroadcastViewProps) {
  const approvedTemplates = useMemo(
    () => templates.filter((t) => t.status === 'APPROVED'),
    [templates]
  );

  const [campaignName, setCampaignName] = useState(
    () => `SNC Broadcast ${new Date().toISOString().slice(0, 10)}`
  );
  const [tagFilter, setTagFilter] = useState<string>('ALL');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [manualNumbers, setManualNumbers] = useState('');
  const [sheetImportUrl, setSheetImportUrl] = useState('');
  const [sheetNotice, setSheetNotice] = useState('');

  const [messageMode, setMessageMode] = useState<'custom' | 'template'>('template');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    approvedTemplates[0]?.id || ''
  );
  const [templateParamMappings, setTemplateParamMappings] = useState<Record<string, string>>({});
  const [messageBody, setMessageBody] = useState('');

  const [attachmentMode, setAttachmentMode] = useState<'none' | 'shared' | 'per-contact'>('none');
  const [sharedAttachment, setSharedAttachment] = useState<Attachment | null>(null);
  const [customAttUrl, setCustomAttUrl] = useState('');
  const [customAttName, setCustomAttName] = useState('');
  const [delayMs, setDelayMs] = useState(() => Math.max(500, Math.min(5000, rateLimitMs || 1500)));

  const [previewIdx, setPreviewIdx] = useState(0);
  const [validationError, setValidationError] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const [isDispatching, setIsDispatching] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [isQueueing, setIsQueueing] = useState(false);
  const [executionResults, setExecutionResults] = useState<BulkExecutionRowResult[]>([]);
  const [progress, setProgress] = useState<{
    processed: number;
    total: number;
    sent: number;
    failed: number;
  } | null>(null);

  const controlRef = useRef<BulkDispatchControl>({ paused: false, stopped: false });
  const csvInputRef = useRef<HTMLInputElement | null>(null);
  const attUploadRef = useRef<HTMLInputElement | null>(null);

  const todaySentCount = useMemo(() => {
    const todayPrefix = new Date().toISOString().slice(0, 10);
    return messages.filter(
      (m) =>
        m.direction === 'outbound' &&
        m.status !== 'failed' &&
        (m.timestamp || '').startsWith(todayPrefix)
    ).length;
  }, [messages]);

  const effectiveQuotaCap = Math.max(100, dailyQuotaCap || 850);
  const quotaRemaining = Math.max(0, effectiveQuotaCap - todaySentCount);
  const quotaUsagePct = Math.min(100, Math.round((todaySentCount / effectiveQuotaCap) * 100));

  const allTags = useMemo(() => {
    const set = new Set<string>();
    contacts.forEach((c) => c.tags.forEach((t) => set.add(t)));
    return ['ALL', ...Array.from(set)];
  }, [contacts]);

  const visibleContacts = useMemo(() => {
    if (tagFilter === 'ALL') return contacts;
    return contacts.filter((c) => c.tags.includes(tagFilter));
  }, [contacts, tagFilter]);

  const recipientQueue = useMemo(() => {
    const chosen = contacts.filter((c) => selectedIds.includes(c.id));
    return buildBulkRecipients(chosen, manualNumbers, defaultCountryCode);
  }, [contacts, selectedIds, manualNumbers, defaultCountryCode]);

  const activeTemplate = useMemo(
    () => approvedTemplates.find((t) => t.id === selectedTemplateId) || approvedTemplates[0],
    [approvedTemplates, selectedTemplateId]
  );

  const activeTemplateSchema = useMemo(
    () => (activeTemplate ? parseApprovedTemplateSchema(activeTemplate) : null),
    [activeTemplate]
  );

  const resolveTemplateParamsForContact = (
    contact: Contact
  ): BulkTemplateParamResolution => {
    if (!activeTemplate || !activeTemplateSchema) {
      return { bodyParams: [], headerParams: [], buttonParams: [] };
    }
    const todayFormatted = (() => {
      const d = new Date().toISOString().slice(0, 10).split('-');
      return `${d[2]}-${d[1]}-${d[0]}`;
    })();

    const resolveField = (key: string, format: string, idx: number): string => {
      const raw = (
        templateParamMappings[key] ??
        (format === 'date'
          ? todayFormatted
          : idx === 0 && format === 'text'
            ? '{{name}}'
            : '')
      ).trim();
      const rendered = renderMessageTemplate(raw, contact).trim();
      if (format === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(rendered)) {
        const parts = rendered.split('-');
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
      return rendered;
    };

    const bodyParams = activeTemplateSchema.bodyFields.map((f, idx) =>
      resolveField(`${activeTemplate.id}:body:${f.token}`, f.format, idx)
    );
    const headerParams = activeTemplateSchema.headerTextFields.map((f, idx) =>
      resolveField(`${activeTemplate.id}:hdr:${f.token}`, f.format, idx)
    );
    const buttonParams = activeTemplateSchema.buttonUrlField
      ? [resolveField(`${activeTemplate.id}:btn:1`, 'url', 0)].filter(Boolean)
      : [];

    return {
      bodyParams,
      headerParams,
      buttonParams,
      headerType: activeTemplate.headerType,
      language: activeTemplate.language,
    };
  };

  const effectiveMessageBody =
    messageMode === 'template' && activeTemplate ? activeTemplate.body : messageBody;

  const previewRecipient =
    recipientQueue.valid[Math.min(previewIdx, Math.max(0, recipientQueue.valid.length - 1))] ||
    contacts[0];

  const previewText = useMemo(() => {
    if (messageMode === 'template' && activeTemplate) {
      if (previewRecipient) {
        const resolved = resolveTemplateParamsForContact(previewRecipient);
        return renderApprovedTemplatePreview(
          activeTemplate,
          resolved.bodyParams,
          resolved.headerParams
        ).bodyPreview;
      }
      return activeTemplate.body;
    }
    return previewRecipient
      ? renderMessageTemplate(effectiveMessageBody, previewRecipient)
      : effectiveMessageBody;
  }, [messageMode, activeTemplate, previewRecipient, effectiveMessageBody, templateParamMappings]);

  const previewAttachment = previewRecipient
    ? resolveRecipientAttachment(attachmentMode, sharedAttachment, previewRecipient)
    : null;

  const willExceedQuota = recipientQueue.valid.length > quotaRemaining;

  const toggleContact = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSelectAllVisible = () => {
    const visibleIds = visibleContacts.map((c) => c.id);
    const allSelected = visibleIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const handleDownloadSampleCsv = () => {
    const blob = new Blob([SAMPLE_WATI_BULK_CSV], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sample_wati_bulk_import_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportResultsCsv = () => {
    if (executionResults.length === 0) return;
    const header = ['Name', 'Phone', 'Status', 'Error', 'Timestamp'].join(',');
    const rows = executionResults.map((r) =>
      [r.name, r.phone, r.status, r.error || '', r.timestamp]
        .map((val) => `"${String(val).replace(/"/g, '""')}"`)
        .join(',')
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `snc-broadcast-results-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCsvUpload = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const parsed = parseCsvContacts(text, defaultCountryCode);
    if (parsed.contacts.length === 0) {
      setSheetNotice('No valid WhatsApp numbers found in the uploaded CSV.');
      return;
    }
    onImportContacts(parsed.contacts);
    setSelectedIds((prev) =>
      Array.from(new Set([...prev, ...parsed.contacts.map((c) => c.id)]))
    );
    setSheetNotice(
      `Imported ${parsed.contacts.length} contact(s) from CSV${
        parsed.skippedRows > 0 ? ` (${parsed.skippedRows} skipped)` : ''
      }.`
    );
  };

  const handleSheetImport = async () => {
    setSheetNotice('');
    if (!sheetImportUrl.trim()) {
      setSheetNotice('Paste a Google Sheets URL or Spreadsheet ID first.');
      return;
    }
    try {
      const count = await onImportFromGoogleSheet(sheetImportUrl.trim());
      setSheetNotice(`Imported ${count} contact(s) from Google Sheets.`);
      setSheetImportUrl('');
    } catch (err) {
      setSheetNotice(err instanceof Error ? err.message : 'Unable to read Google Sheet.');
    }
  };

  const handleUploadSharedAttachment = async (file: File | undefined) => {
    if (!file) return;
    const kind = inferAttachmentKind(file.type, file.name);
    if (gatewayConfigured) {
      const uploaded = await onUploadFileToDrive(file);
      if (uploaded) {
        setSharedAttachment({
          id: uploaded.id,
          kind: uploaded.kind,
          name: uploaded.name,
          mimeType: uploaded.mimeType,
          url: uploaded.downloadUrl,
          sizeBytes: uploaded.sizeBytes,
          driveFileId: uploaded.id,
        });
        return;
      }
    }
    setSharedAttachment({
      id: `bulk-att-${Date.now()}`,
      kind,
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      url: URL.createObjectURL(file),
      sizeBytes: file.size,
    });
  };

  const handleApplyCustomAttachmentUrl = () => {
    setValidationError('');
    if (!isSafeHttpsUrl(customAttUrl)) {
      setValidationError('Shared attachment URL must start with https://.');
      return;
    }
    const name =
      customAttName.trim() ||
      customAttUrl.split('/').pop()?.split('?')[0] ||
      'broadcast_attachment.pdf';
    const kind = inferAttachmentKind('', name);
    setSharedAttachment({
      id: `url-${Date.now()}`,
      kind,
      name,
      mimeType:
        kind === 'image' ? 'image/jpeg' : kind === 'video' ? 'video/mp4' : 'application/pdf',
      url: customAttUrl.trim(),
    });
    setCustomAttUrl('');
    setCustomAttName('');
  };

  const validateCampaignInputs = (): boolean => {
    setValidationError('');
    setActionNotice('');
    if (!campaignName.trim()) {
      setValidationError('Enter a campaign name before dispatching.');
      return false;
    }
    if (recipientQueue.valid.length === 0) {
      setValidationError('Select at least one valid WhatsApp recipient.');
      return false;
    }
    if (messageMode === 'template' && activeTemplate && activeTemplateSchema) {
      if (
        activeTemplateSchema.headerMediaType !== 'NONE' &&
        attachmentMode === 'none'
      ) {
        setValidationError(
          `Approved template "${activeTemplate.name}" requires a ${activeTemplateSchema.headerMediaType} header. Choose "Shared File" or "Per-Contact URL" in Step 3.`
        );
        return false;
      }
      const sampleRecipient = recipientQueue.valid[0];
      if (sampleRecipient) {
        const resolved = resolveTemplateParamsForContact(sampleRecipient);
        const missingBodyIdx = resolved.bodyParams.findIndex((v) => !v);
        if (missingBodyIdx >= 0) {
          const field = activeTemplateSchema.bodyFields[missingBodyIdx];
          setValidationError(
            `Enter a value or contact field for ${field.label} (${field.formatLabel}) before dispatching.`
          );
          return false;
        }
        const missingHdrIdx = resolved.headerParams.findIndex((v) => !v);
        if (missingHdrIdx >= 0) {
          const field = activeTemplateSchema.headerTextFields[missingHdrIdx];
          setValidationError(
            `Enter a value for ${field.label} (${field.formatLabel}) before dispatching.`
          );
          return false;
        }
      }
    }
    if (!effectiveMessageBody.trim() && attachmentMode === 'none') {
      setValidationError('Enter a message body or attach a media file.');
      return false;
    }
    if (attachmentMode === 'shared' && !sharedAttachment) {
      setValidationError('Choose or upload a shared attachment, or switch attachment mode.');
      return false;
    }
    return true;
  };

  const handleSendTestRow1 = async () => {
    if (!validateCampaignInputs()) return;
    const first = recipientQueue.valid[0];
    if (!first) return;
    setIsSendingTest(true);
    try {
      const att = resolveRecipientAttachment(attachmentMode, sharedAttachment, first) || undefined;
      if (messageMode === 'template' && activeTemplate) {
        const resolved = resolveTemplateParamsForContact(first);
        const preview = renderApprovedTemplatePreview(
          activeTemplate,
          resolved.bodyParams,
          resolved.headerParams
        );
        await onSendTestMessage({
          contact: first,
          body: preview.bodyPreview,
          attachment: att,
          templateName: activeTemplate.name,
          templateLanguage: resolved.language,
          templateParams: resolved.bodyParams,
          templateHeaderType: resolved.headerType,
          templateHeaderParams: resolved.headerParams,
          templateButtonParams: resolved.buttonParams,
        });
      } else {
        const rendered = renderMessageTemplate(effectiveMessageBody, first);
        await onSendTestMessage({
          contact: first,
          body: rendered,
          attachment: att,
        });
      }
      setActionNotice(
        `Test Row 1 dispatched to ${first.name} (${formatPhoneDisplay(first.phone)}). Verify on WhatsApp before launching full batch.`
      );
    } finally {
      setIsSendingTest(false);
    }
  };

  const handleQueueToWorker = async () => {
    if (!validateCampaignInputs()) return;
    setIsQueueing(true);
    try {
      const res = await onQueueBulkCampaign({
        campaignName: campaignName.trim(),
        recipients: recipientQueue.valid,
        messageTemplate: effectiveMessageBody,
        templateName:
          messageMode === 'template' && activeTemplate
            ? activeTemplate.name
            : 'custom_broadcast',
        attachmentMode,
        sharedAttachment,
      });
      setActionNotice(res.message);
    } finally {
      setIsQueueing(false);
    }
  };

  const handleTogglePause = () => {
    controlRef.current.paused = !controlRef.current.paused;
    setIsPaused(controlRef.current.paused);
  };

  const handleStopDispatch = () => {
    controlRef.current.stopped = true;
    controlRef.current.paused = false;
    setIsPaused(false);
    setActionNotice('Stopping broadcast after current recipient completes...');
  };

  const handleLaunchClick = () => {
    if (!validateCampaignInputs()) return;

    onRequestConfirmation({
      title: `Launch "${campaignName.trim()}"?`,
      description: `This will dispatch personalized WhatsApp messages to ${recipientQueue.valid.length} verified recipient(s) at ${delayMs}ms anti-ban interval and log results to SNC Master Sheet.`,
      details: [
        `Recipients: ${recipientQueue.valid.length} valid${
          recipientQueue.invalidEntries.length > 0
            ? ` (${recipientQueue.invalidEntries.length} invalid skipped)`
            : ''
        }`,
        `Anti-Ban Throttle: ${delayMs}ms interval`,
        `Message Mode: ${
          messageMode === 'template' && activeTemplate
            ? `Template (${activeTemplate.name})`
            : 'Custom Personalized Text'
        }`,
        `Attachment Mode: ${
          attachmentMode === 'none'
            ? 'Text Only'
            : attachmentMode === 'shared'
              ? `Shared file (${sharedAttachment?.name})`
              : 'Per-Contact Drive Attachment Column'
        }`,
      ],
      confirmLabel: `Send to ${recipientQueue.valid.length} Contacts`,
      onConfirm: async () => {
        controlRef.current = { paused: false, stopped: false };
        setIsPaused(false);
        setIsDispatching(true);
        setExecutionResults([]);
        setProgress({
          processed: 0,
          total: recipientQueue.valid.length,
          sent: 0,
          failed: 0,
        });
        try {
          await onRunBulkCampaign({
            campaignName: campaignName.trim(),
            recipients: recipientQueue.valid,
            messageTemplate: effectiveMessageBody,
            templateName:
              messageMode === 'template' && activeTemplate
                ? activeTemplate.name
                : 'custom_broadcast',
            attachmentMode,
            sharedAttachment,
            delayMs,
            controlRef,
            resolveTemplateParams:
              messageMode === 'template' && activeTemplate
                ? resolveTemplateParamsForContact
                : undefined,
            onProgress: (stats) => {
              setProgress({
                processed: stats.processed,
                total: recipientQueue.valid.length,
                sent: stats.sent,
                failed: stats.failed,
              });
              if (stats.rowResult) {
                setExecutionResults((prev) => [...prev, stats.rowResult!]);
              }
            },
          });
        } finally {
          setIsDispatching(false);
          setIsPaused(false);
        }
      },
    });
  };

  return (
    <div className="h-full overflow-y-auto bg-slate-50 px-4 py-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Bulk Broadcast
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Send personalized WhatsApp broadcasts with approved templates, attachments, and throttled dispatch controls.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 tabular-nums">
            <span>{recipientQueue.valid.length} selected recipients</span>
            <span aria-hidden="true">·</span>
            <span>{campaigns.length} logged campaigns</span>
          </div>
        </div>

        {/* Main 2-Column Composer + Live WhatsApp Phone Preview */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
          {/* Left Composer Column */}
          <div className="space-y-6 lg:col-span-7">
            {/* Step 1: Campaign & Audience */}
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-base font-semibold text-slate-900">
                01. Campaign & Target Audience
              </h2>

              <div className="mt-4">
                <label
                  htmlFor="campaign-name-input"
                  className="block text-xs font-medium text-slate-700"
                >
                  Campaign Name
                </label>
                <input
                  id="campaign-name-input"
                  type="text"
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-[#075E54] focus:outline-none"
                />
              </div>

              <div className="mt-4 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-700">Filter by Segment</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSelectAllVisible}
                      className="text-xs font-medium text-[#075E54] hover:underline whitespace-nowrap"
                    >
                      Toggle Visible ({visibleContacts.length})
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadSampleCsv}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                    >
                      <Download className="h-3.5 w-3.5 text-[#075E54]" />
                      <span>Sample WATI CSV</span>
                    </button>
                    <input
                      ref={csvInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      onChange={(e) => void handleCsvUpload(e.target.files?.[0])}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => csvInputRef.current?.click()}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      <span>Upload CSV</span>
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {allTags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setTagFilter(tag)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap ${
                        tagFilter === tag
                          ? 'bg-[#075E54] text-white'
                          : 'bg-slate-100 text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>

              {/* Contacts Checklist */}
              <div className="mt-3 max-h-48 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                {visibleContacts.map((c) => {
                  const checked = selectedIds.includes(c.id);
                  const isOptedOut = c.tags.includes('#opt_out');
                  return (
                    <label
                      key={c.id}
                      className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-xs hover:bg-slate-50"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleContact(c.id)}
                          className="h-4 w-4 rounded border-slate-300 accent-[#075E54]"
                        />
                        <span className="truncate font-medium text-slate-900">{c.name}</span>
                        <span className="truncate text-slate-500">{c.company}</span>
                        {isOptedOut && (
                          <span className="rounded bg-red-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-red-700">
                            #opt_out
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 font-mono text-slate-500 tabular-nums">
                        {formatPhoneDisplay(c.phone)}
                      </span>
                    </label>
                  );
                })}
              </div>

              {/* Manual Numbers + Google Sheet Quick Pull */}
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="manual-numbers-input"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Extra Phone Numbers (comma or newline)
                  </label>
                  <textarea
                    id="manual-numbers-input"
                    rows={2}
                    value={manualNumbers}
                    onChange={(e) => setManualNumbers(e.target.value)}
                    placeholder="+919820112233, 9876543210"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs focus:border-[#075E54] focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="sheet-import-url"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Import Audience from Google Sheet
                  </label>
                  <div className="mt-1 flex gap-1.5">
                    <input
                      id="sheet-import-url"
                      type="text"
                      value={sheetImportUrl}
                      onChange={(e) => setSheetImportUrl(e.target.value)}
                      placeholder="Paste Sheet URL or ID..."
                      className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-2 text-xs focus:border-[#075E54] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSheetImport()}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5 text-[#075E54]" />
                      <span>Import</span>
                    </button>
                  </div>
                  {sheetNotice && (
                    <p className="mt-1 text-xs text-slate-600">{sheetNotice}</p>
                  )}
                </div>
              </div>
            </section>

            {/* Step 2: Message Personalization */}
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-slate-900">
                  02. Customize Message & Merge Fields
                </h2>
                <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => setMessageMode('custom')}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                      messageMode === 'custom'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600'
                    }`}
                  >
                    Custom Message
                  </button>
                  <button
                    type="button"
                    onClick={() => setMessageMode('template')}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                      messageMode === 'template'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600'
                    }`}
                  >
                    Approved Template
                  </button>
                </div>
              </div>

              {messageMode === 'template' ? (
                <div className="mt-4">
                  <label
                    htmlFor="broadcast-template-select"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Select Pre-Approved Meta WhatsApp Template
                  </label>
                  {approvedTemplates.length === 0 ? (
                    <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                      No pre-approved Meta templates synced yet. Open Pre-Approved Templates on the left sidebar and click Sync Approved Templates to pull your live WABA templates.
                    </p>
                  ) : (
                    <>
                      <select
                        id="broadcast-template-select"
                        value={activeTemplate?.id || ''}
                        onChange={(e) => setSelectedTemplateId(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#075E54] focus:outline-none"
                      >
                        {approvedTemplates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.category} · {t.language} · APPROVED)
                          </option>
                        ))}
                      </select>
                      {activeTemplate && activeTemplateSchema && (
                        <div className="mt-3 space-y-3">
                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                              Locked Approved Template Format ({activeTemplate.language})
                            </p>
                            <p className="mt-1 whitespace-pre-wrap">{activeTemplate.body}</p>
                          </div>

                          {activeTemplateSchema.headerMediaType !== 'NONE' && (
                            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
                              Required Header Media: Select a <strong>{activeTemplateSchema.headerMediaType}</strong> in Step 3 (Shared File or Per-Contact URL) so Meta accepts this template.
                            </p>
                          )}

                          {(activeTemplateSchema.headerTextFields.length > 0 ||
                            activeTemplateSchema.bodyFields.length > 0 ||
                            activeTemplateSchema.buttonUrlField) && (
                            <div className="space-y-2.5 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
                              <p className="text-xs font-semibold text-emerald-950">
                                Approved Template Parameters (Use Contact Merge Fields like{' '}
                                <span className="font-mono">&#123;&#123;name&#125;&#125;</span>,{' '}
                                <span className="font-mono">&#123;&#123;custom1&#125;&#125;</span> or fixed values)
                              </p>
                              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                                {activeTemplateSchema.headerTextFields.map((field) => {
                                  const key = `${activeTemplate.id}:hdr:${field.token}`;
                                  return (
                                    <div key={key}>
                                      <div className="flex items-center justify-between gap-2">
                                        <label
                                          htmlFor={`bulk-${key}`}
                                          className="text-[11px] font-semibold text-slate-800"
                                        >
                                          {field.label}
                                        </label>
                                        <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#075E54] border border-slate-200">
                                          {field.formatLabel}
                                        </span>
                                      </div>
                                      <input
                                        id={`bulk-${key}`}
                                        type={field.format === 'date' ? 'date' : 'text'}
                                        value={templateParamMappings[key] ?? ''}
                                        onChange={(e) =>
                                          setTemplateParamMappings((prev) => ({
                                            ...prev,
                                            [key]: e.target.value,
                                          }))
                                        }
                                        placeholder={field.example || `Enter ${field.formatLabel.toLowerCase()} or {{custom1}}`}
                                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-[#075E54] focus:outline-none"
                                      />
                                    </div>
                                  );
                                })}

                                {activeTemplateSchema.bodyFields.map((field, idx) => {
                                  const key = `${activeTemplate.id}:body:${field.token}`;
                                  const defaultVal =
                                    field.format === 'date'
                                      ? new Date().toISOString().slice(0, 10)
                                      : idx === 0 && field.format === 'text'
                                        ? '{{name}}'
                                        : '';
                                  return (
                                    <div key={key}>
                                      <div className="flex items-center justify-between gap-2">
                                        <label
                                          htmlFor={`bulk-${key}`}
                                          className="text-[11px] font-semibold text-slate-800"
                                        >
                                          {field.label}
                                        </label>
                                        <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#075E54] border border-slate-200">
                                          {field.formatLabel}
                                        </span>
                                      </div>
                                      <input
                                        id={`bulk-${key}`}
                                        type={field.format === 'date' ? 'date' : 'text'}
                                        inputMode={field.format === 'number' ? 'decimal' : undefined}
                                        value={templateParamMappings[key] ?? defaultVal}
                                        onChange={(e) =>
                                          setTemplateParamMappings((prev) => ({
                                            ...prev,
                                            [key]: e.target.value,
                                          }))
                                        }
                                        placeholder={
                                          field.example
                                            ? `e.g. ${field.example}`
                                            : `Enter ${field.formatLabel.toLowerCase()} or {{custom1}}`
                                        }
                                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-[#075E54] focus:outline-none"
                                      />
                                    </div>
                                  );
                                })}

                                {activeTemplateSchema.buttonUrlField && (
                                  <div className="sm:col-span-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <label
                                        htmlFor={`bulk-${activeTemplate.id}:btn:1`}
                                        className="text-[11px] font-semibold text-slate-800"
                                      >
                                        {activeTemplateSchema.buttonUrlField.label}
                                      </label>
                                      <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#075E54] border border-slate-200">
                                        Link
                                      </span>
                                    </div>
                                    <input
                                      id={`bulk-${activeTemplate.id}:btn:1`}
                                      type="text"
                                      value={templateParamMappings[`${activeTemplate.id}:btn:1`] ?? ''}
                                      onChange={(e) =>
                                        setTemplateParamMappings((prev) => ({
                                          ...prev,
                                          [`${activeTemplate.id}:btn:1`]: e.target.value,
                                        }))
                                      }
                                      placeholder="Enter URL suffix or {{custom1}}"
                                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-[#075E54] focus:outline-none"
                                    />
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div className="mt-4">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-slate-500">Insert variable:</span>
                    {MERGE_FIELDS.map((field) => (
                      <button
                        key={field.token}
                        type="button"
                        onClick={() => setMessageBody((prev) => `${prev} ${field.token}`)}
                        className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-700 hover:border-[#075E54] hover:text-[#075E54]"
                      >
                        {field.token}
                      </button>
                    ))}
                  </div>
                  <label htmlFor="broadcast-message-body" className="sr-only">
                    Broadcast message text
                  </label>
                  <textarea
                    id="broadcast-message-body"
                    rows={4}
                    value={messageBody}
                    onChange={(e) => setMessageBody(e.target.value)}
                    className="mt-2.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm leading-relaxed text-slate-900 focus:border-[#075E54] focus:outline-none"
                  />
                </div>
              )}
            </section>

            {/* Step 3: Custom Attachments & Anti-Ban Dispatch Controls */}
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-base font-semibold text-slate-900">
                03. Customize Attachments & Anti-Ban Dispatch Controls
              </h2>

              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(
                  [
                    { id: 'none', title: 'Text Only', desc: 'No media attached' },
                    { id: 'shared', title: 'Shared File', desc: 'Same PDF/image to all' },
                    {
                      id: 'per-contact',
                      title: 'Per-Contact URL',
                      desc: 'Unique file per Sheet row',
                    },
                  ] as const
                ).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setAttachmentMode(mode.id)}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      attachmentMode === mode.id
                        ? 'border-[#075E54] bg-emerald-50/50 text-slate-900'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <p className="text-xs font-semibold">{mode.title}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">{mode.desc}</p>
                  </button>
                ))}
              </div>

              {attachmentMode === 'shared' && (
                <div className="mt-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={attUploadRef}
                      type="file"
                      accept="*/*"
                      onChange={(e) => void handleUploadSharedAttachment(e.target.files?.[0])}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => attUploadRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Paperclip className="h-3.5 w-3.5 text-[#075E54]" />
                      <span>Upload New File</span>
                    </button>
                    {driveFiles.slice(0, 3).map((df) => (
                      <button
                        key={df.id}
                        type="button"
                        onClick={() =>
                          setSharedAttachment({
                            id: df.id,
                            kind: df.kind,
                            name: df.name,
                            mimeType: df.mimeType,
                            url: df.downloadUrl,
                            sizeBytes: df.sizeBytes,
                          })
                        }
                        className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                          sharedAttachment?.id === df.id
                            ? 'border-[#075E54] bg-emerald-50 text-[#075E54] font-medium'
                            : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {df.name}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <input
                      type="url"
                      value={customAttUrl}
                      onChange={(e) => setCustomAttUrl(e.target.value)}
                      placeholder="https://drive.google.com/uc?id=..."
                      aria-label="Custom shared attachment URL"
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs focus:border-[#075E54] focus:outline-none sm:col-span-2"
                    />
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={customAttName}
                        onChange={(e) => setCustomAttName(e.target.value)}
                        placeholder="Filename"
                        aria-label="Custom shared attachment filename"
                        className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-[#075E54] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleApplyCustomAttachmentUrl}
                        className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
                      >
                        Set
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {attachmentMode === 'per-contact' && (
                <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  Each recipient receives their individual{' '}
                  <span className="font-mono font-medium text-slate-800">attachment_url</span>{' '}
                  from your Contacts Google Sheet (for example, individual GST invoices or dispatch PDFs).
                </p>
              )}

              {/* Anti-Ban Throttle Slider (500ms – 5000ms) */}
              <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <label
                    htmlFor="anti-ban-throttle-slider"
                    className="text-xs font-semibold text-slate-800"
                  >
                    Anti-Ban Throttle Delay
                  </label>
                  <span className="font-mono text-xs font-semibold text-[#075E54] tabular-nums">
                    {delayMs} ms ({(delayMs / 1000).toFixed(2)}s / msg)
                  </span>
                </div>
                <input
                  id="anti-ban-throttle-slider"
                  type="range"
                  min={500}
                  max={5000}
                  step={250}
                  value={delayMs}
                  onChange={(e) => setDelayMs(Number(e.target.value))}
                  className="mt-2 w-full accent-[#075E54]"
                />
                <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-400">
                  <span>500ms (Fast)</span>
                  <span>1500ms (Recommended)</span>
                  <span>5000ms (Ultra Safe)</span>
                </div>
              </div>

              {/* Action Buttons: Test Row 1, Queue to Worker, Launch Live */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2.5 border-t border-slate-100 pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isDispatching || isSendingTest || recipientQueue.valid.length === 0}
                    onClick={() => void handleSendTestRow1()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
                  >
                    <FlaskConical className="h-3.5 w-3.5 text-[#075E54]" />
                    <span>{isSendingTest ? 'Sending Test...' : 'Send Test (Row 1)'}</span>
                  </button>

                  <button
                    type="button"
                    disabled={isDispatching || isQueueing || recipientQueue.valid.length === 0}
                    onClick={() => void handleQueueToWorker()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
                  >
                    <Clock className="h-3.5 w-3.5 text-[#075E54]" />
                    <span>{isQueueing ? 'Queueing...' : 'Queue to Worker Sheet'}</span>
                  </button>
                </div>

                <button
                  type="button"
                  disabled={isDispatching}
                  onClick={handleLaunchClick}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#075E54] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#064c44] disabled:opacity-60 whitespace-nowrap"
                >
                  <Send className="h-4 w-4" />
                  <span>
                    {isDispatching
                      ? isPaused
                        ? 'Broadcast Paused'
                        : 'Sending Broadcast...'
                      : `Launch Broadcast (${recipientQueue.valid.length})`}
                  </span>
                </button>
              </div>

              {validationError && (
                <p className="mt-3 text-xs font-medium text-red-600" role="alert">
                  {validationError}
                </p>
              )}

              {actionNotice && (
                <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900">
                  {actionNotice}
                </p>
              )}

              {progress && (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-slate-700 tabular-nums">
                    <span>
                      Dispatched {progress.processed} / {progress.total}
                    </span>
                    <div className="flex items-center gap-3">
                      <span>
                        Sent: {progress.sent} · Failed: {progress.failed}
                      </span>
                      {isDispatching && (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={handleTogglePause}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                          >
                            {isPaused ? (
                              <>
                                <Play className="h-3 w-3 text-[#075E54]" />
                                <span>Resume</span>
                              </>
                            ) : (
                              <>
                                <Pause className="h-3 w-3 text-amber-600" />
                                <span>Pause</span>
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={handleStopDispatch}
                            className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-100"
                          >
                            <Square className="h-3 w-3" />
                            <span>Stop</span>
                          </button>
                        </div>
                      )}
                      {!isDispatching && executionResults.length > 0 && (
                        <button
                          type="button"
                          onClick={handleExportResultsCsv}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                        >
                          <Download className="h-3 w-3 text-[#075E54]" />
                          <span>Export Results CSV</span>
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full transition-all duration-200 ${
                        isPaused ? 'bg-amber-500' : 'bg-[#075E54]'
                      }`}
                      style={{
                        width: `${Math.round(
                          (progress.processed / Math.max(1, progress.total)) * 100
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </section>
          </div>

          {/* Right Column: Live Personalized WhatsApp Preview */}
          <div className="lg:col-span-5 lg:sticky lg:top-6">
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">
                  Live Recipient Preview
                </h2>
                {recipientQueue.valid.length > 0 && (
                  <select
                    aria-label="Preview recipient"
                    value={Math.min(previewIdx, recipientQueue.valid.length - 1)}
                    onChange={(e) => setPreviewIdx(Number(e.target.value))}
                    className="max-w-[180px] truncate rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700"
                  >
                    {recipientQueue.valid.map((r, i) => (
                      <option key={r.id} value={i}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Realistic WhatsApp Phone Frame */}
              <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
                <div className="flex items-center justify-between bg-[#075E54] px-4 py-3 text-white">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">SNC Whats App</p>
                    <p className="truncate text-[11px] text-emerald-100">
                      To: {previewRecipient?.name || 'Recipient'}{' '}
                      {previewRecipient ? `(${formatPhoneDisplay(previewRecipient.phone)})` : ''}
                    </p>
                  </div>
                  <span className="text-[11px] text-emerald-100 whitespace-nowrap">
                    Official Business
                  </span>
                </div>

                <div className="chat-wallpaper min-h-[260px] p-4">
                  <div className="ml-auto max-w-[90%] rounded-xl rounded-tr-xs bg-[#D9FDD3] p-3 shadow-xs">
                    {previewAttachment && (
                      <div className="mb-2 flex items-center gap-2.5 rounded-lg border border-black/10 bg-white/90 p-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-[#075E54]">
                          {previewAttachment.kind === 'image' ? (
                            <ImageIcon className="h-4 w-4" />
                          ) : (
                            <FileText className="h-4 w-4" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-slate-900">
                            {previewAttachment.name}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {previewAttachment.kind.toUpperCase()}
                            {previewAttachment.sizeBytes
                              ? ` · ${formatFileSize(previewAttachment.sizeBytes)}`
                              : ''}
                          </p>
                        </div>
                      </div>
                    )}
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-900">
                      {previewText || 'Start typing a message to preview...'}
                    </p>
                    <div className="mt-1.5 flex items-center justify-end gap-1 text-[11px] text-slate-500">
                      <span className="font-mono tabular-nums">Now</span>
                      <CheckCheck className="h-3.5 w-3.5 text-sky-600" />
                    </div>
                  </div>
                </div>
              </div>

              {recipientQueue.invalidEntries.length > 0 && (
                <p className="mt-3 text-xs text-amber-700">
                  Skipped {recipientQueue.invalidEntries.length} invalid phone entry:{' '}
                  {recipientQueue.invalidEntries.slice(0, 3).join(', ')}
                </p>
              )}
            </section>
          </div>
        </div>

        {/* Campaign History Table (Live Status Synced from Message Receipts) */}
        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-900">
              Recent Broadcast Campaigns
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="px-5 py-3">Campaign</th>
                  <th className="px-4 py-3">Attachment</th>
                  <th className="px-4 py-3 text-right">Recipients</th>
                  <th className="px-4 py-3 text-right">Sent</th>
                  <th className="px-4 py-3 text-right">Delivered</th>
                  <th className="px-4 py-3 text-right">Seen / Read</th>
                  <th className="px-4 py-3 text-right">Failed</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {campaigns.map((cmp) => {
                  const cmpTimeMs = new Date(cmp.createdAt).getTime();
                  let linkedMsgs = messages.filter(
                    (m) => m.direction === 'outbound' && m.campaignId === cmp.id
                  );
                  // Fallback match for legacy rows synced without campaignId
                  if (linkedMsgs.length === 0 && !Number.isNaN(cmpTimeMs)) {
                    linkedMsgs = messages.filter((m) => {
                      if (m.direction !== 'outbound') return false;
                      if (
                        cmp.templateName &&
                        cmp.templateName !== 'custom_broadcast' &&
                        m.templateName !== cmp.templateName
                      ) {
                        return false;
                      }
                      const mTime = new Date(m.timestamp).getTime();
                      return !Number.isNaN(mTime) && Math.abs(mTime - cmpTimeMs) <= 10 * 60 * 1000;
                    });
                  }

                  const liveSent = Math.max(
                    cmp.sent,
                    linkedMsgs.filter((m) => m.status !== 'failed' && m.status !== 'queued').length
                  );
                  const liveDelivered = Math.max(
                    cmp.delivered,
                    linkedMsgs.filter((m) => m.status === 'delivered' || m.status === 'read').length
                  );
                  const liveSeen = linkedMsgs.filter((m) => m.status === 'read').length;
                  const liveFailed = Math.max(
                    cmp.failed,
                    linkedMsgs.filter((m) => m.status === 'failed').length
                  );

                  let statusText: string = cmp.status;
                  let statusTone = 'text-slate-700';
                  if (liveSeen > 0) {
                    statusText = liveSeen >= Math.max(1, liveSent) ? 'Seen' : `Seen (${liveSeen}/${liveSent})`;
                    statusTone = 'text-sky-700 font-semibold';
                  } else if (liveDelivered > 0) {
                    statusText =
                      liveDelivered >= Math.max(1, liveSent)
                        ? 'Delivered'
                        : `Delivered (${liveDelivered}/${liveSent})`;
                    statusTone = 'text-emerald-700 font-semibold';
                  } else if (liveFailed > 0 && liveSent === 0) {
                    statusText = 'Failed';
                    statusTone = 'text-red-600 font-semibold';
                  } else if (cmp.status === 'completed') {
                    statusText = 'Sent';
                  }

                  return (
                    <tr key={cmp.id} className="hover:bg-slate-50/70">
                      <td className="px-5 py-3">
                        <p className="font-medium text-slate-900">{cmp.name}</p>
                        <p className="font-mono text-xs text-slate-400 tabular-nums">
                          {new Date(cmp.createdAt).toLocaleDateString()} · {cmp.templateName}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {cmp.attachmentMode === 'none'
                          ? 'None'
                          : cmp.attachmentName || cmp.attachmentMode}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-slate-900 tabular-nums">
                        {cmp.totalRecipients}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-slate-900 tabular-nums">
                        {liveSent}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-emerald-700 tabular-nums">
                        {liveDelivered}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-sky-700 tabular-nums">
                        {liveSeen}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-red-600 tabular-nums">
                        {liveFailed}
                      </td>
                      <td className={`px-5 py-3 text-xs capitalize ${statusTone}`}>
                        {statusText}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
