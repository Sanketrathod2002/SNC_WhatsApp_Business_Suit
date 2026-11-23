import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Bot,
  Check,
  Code2,
  Copy,
  Download,
  Edit3,
  FileSpreadsheet,
  Lock,
  Plus,
  RotateCw,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import type {
  ChatMessage,
  Contact,
  ExternalSheetSource,
  MessageBillingCategory,
  WorkspaceConfig,
} from '../types';
import {
  generateGatewayAppsScriptCode,
  generateRetailerSheetDropInScript,
  generateWorkerAppsScriptCode,
} from '../utils/appsScriptTemplate';
import { formatPhoneDisplay } from '../utils/whatsappLogic';
import {
  buildSetupGuidePdfHtml,
  openHtmlDocumentInNewTab,
} from '../utils/printableReports';

interface DeveloperToolsViewProps {
  config: WorkspaceConfig;
  contacts: Contact[];
  messages: ChatMessage[];
  externalSheets: ExternalSheetSource[];
  onAddExternalSheet: (sheet: ExternalSheetSource) => void;
  onUpdateExternalSheet: (id: string, patch: Partial<ExternalSheetSource>) => void;
  onDeleteExternalSheet: (id: string) => void;
  onRetryFailedMessage: (msg: ChatMessage) => Promise<void>;
  onUpdateContact: (contactId: string, patch: Partial<Contact>) => void;
  onLockAdmin?: () => void;
}

type DevTab = 'scripts' | 'guide' | 'sheets' | 'retry' | 'bot';

export function DeveloperToolsView({
  config,
  contacts,
  messages,
  externalSheets,
  onAddExternalSheet,
  onUpdateExternalSheet,
  onDeleteExternalSheet,
  onRetryFailedMessage,
  onUpdateContact,
  onLockAdmin,
}: DeveloperToolsViewProps) {
  const [activeTab, setActiveTab] = useState<DevTab>('scripts');
  const [scriptChoice, setScriptChoice] = useState<'gateway' | 'worker' | 'retailer'>('gateway');
  const [copiedCode, setCopiedCode] = useState(false);

  // External Sheet Add/Edit Form
  const [editingSheetId, setEditingSheetId] = useState<string | null>(null);
  const [sheetLabel, setSheetLabel] = useState('');
  const [sheetIdInput, setSheetIdInput] = useState('');
  const [sheetTabName, setSheetTabName] = useState('Receipt');
  const [sheetTemplate, setSheetTemplate] = useState('retailer_receipt');
  const [sheetCategory, setSheetCategory] = useState<MessageBillingCategory>('UTILITY');

  // Retry state
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const failedMessages = useMemo(
    () =>
      messages
        .filter((m) => m.status === 'failed')
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [messages]
  );

  const optedOutContacts = useMemo(
    () =>
      contacts.filter((c) =>
        c.tags.some((t) => t.toLowerCase().includes('opt_out') || t.toLowerCase() === 'stop')
      ),
    [contacts]
  );

  // Zero keys or IDs embedded — all credentials strictly read from Apps Script Script Properties
  const activeScriptCode = useMemo(() => {
    if (scriptChoice === 'worker') {
      return generateWorkerAppsScriptCode({
        folderId: config.driveFolderId,
        businessName: config.businessName,
      });
    }
    if (scriptChoice === 'retailer') {
      return generateRetailerSheetDropInScript({
        apiVersion: 'v25.0',
      });
    }
    return generateGatewayAppsScriptCode({
      folderId: config.driveFolderId,
      businessName: config.businessName,
      apiVersion: 'v25.0',
    });
  }, [scriptChoice, config.driveFolderId, config.businessName]);

  const activeScriptFilename =
    scriptChoice === 'gateway'
      ? 'Gateway_Code.gs'
      : scriptChoice === 'worker'
        ? 'Worker_Code.gs'
        : 'External_Retailer_Receipt_Code.gs';

  const handleCopyScript = async () => {
    await navigator.clipboard.writeText(activeScriptCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleDownloadScript = () => {
    const blob = new Blob([activeScriptCode], { type: 'text/javascript;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeScriptFilename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveSheetForm = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId =
      sheetIdInput.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] || sheetIdInput.trim();
    if (!sheetLabel.trim() || !cleanId) return;

    if (editingSheetId) {
      onUpdateExternalSheet(editingSheetId, {
        label: sheetLabel.trim(),
        spreadsheetId: cleanId,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${cleanId}/edit`,
        tabName: sheetTabName.trim() || 'Receipt',
        defaultTemplate: sheetTemplate.trim() || 'retailer_receipt',
        defaultCategory: sheetCategory,
      });
      setEditingSheetId(null);
    } else {
      onAddExternalSheet({
        id: `ext-${Date.now()}`,
        label: sheetLabel.trim(),
        spreadsheetId: cleanId,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${cleanId}/edit`,
        tabName: sheetTabName.trim() || 'Receipt',
        defaultTemplate: sheetTemplate.trim() || 'retailer_receipt',
        defaultCategory: sheetCategory,
        colPhone: 'phone',
        colName: 'retailer_name',
        colMessage: 'message',
        colWaId: 'wa_message_id',
        colStatus: 'status',
        colTimestamp: 'sent_at',
        colAttachmentUrl: 'receipt_pdf_url',
        colReceiptNo: 'receipt_no',
        lastSyncedRow: 1,
        lastSyncedAt: null,
        totalSynced: 0,
        enabled: true,
      });
    }
    setSheetLabel('');
    setSheetIdInput('');
    setSheetTabName('Receipt');
    setSheetTemplate('retailer_receipt');
  };

  const startEditSheet = (sheet: ExternalSheetSource) => {
    setEditingSheetId(sheet.id);
    setSheetLabel(sheet.label);
    setSheetIdInput(sheet.spreadsheetId);
    setSheetTabName(sheet.tabName);
    setSheetTemplate(sheet.defaultTemplate);
    setSheetCategory(sheet.defaultCategory);
  };

  const handleOpenSetupGuidePdf = () => {
    const html = buildSetupGuidePdfHtml(config);
    openHtmlDocumentInNewTab(html);
  };

  const tabs: Array<{ id: DevTab; label: string; icon: typeof Code2; count?: number }> = [
    { id: 'scripts', label: 'Dual Apps Scripts', icon: Code2 },
    { id: 'guide', label: 'Setup Guide (PDF)', icon: BookOpen },
    { id: 'sheets', label: 'Linked Sheets', icon: FileSpreadsheet, count: externalSheets.length },
    { id: 'retry', label: 'Failed Retry Center', icon: AlertTriangle, count: failedMessages.length },
    { id: 'bot', label: 'Receipt Bot & Opt-Out', icon: Bot, count: optedOutContacts.length },
  ];

  return (
    <div className="h-full overflow-y-auto bg-slate-50 px-4 py-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Developer Tools & Setup Scripts
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Access deployment scripts, complete step-by-step setup manual (PDF), linked sheets, retry center, and bot controls.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onLockAdmin && (
              <button
                type="button"
                onClick={onLockAdmin}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
              >
                <Lock className="h-3.5 w-3.5 text-slate-600" />
                <span>Lock Section</span>
              </button>
            )}
          </div>
        </div>

        {/* Sub-Navigation Tabs */}
        <div
          role="tablist"
          aria-label="Developer tool tabs"
          className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 pb-3"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-[#075E54] text-white'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tab.label}</span>
                {typeof tab.count === 'number' && (
                  <span
                    className={`font-mono text-[11px] tabular-nums ${
                      active ? 'text-emerald-100' : 'text-slate-400'
                    }`}
                  >
                    ({tab.count})
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* TAB 1: Dual Apps Script Architecture */}
        {activeTab === 'scripts' && (
          <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-100 p-1">
                {(
                  [
                    { id: 'gateway', label: 'Gateway_Code.gs (Master)' },
                    { id: 'worker', label: 'Worker_Code.gs (1-Min Queue + Sharding)' },
                    { id: 'retailer', label: 'External Retailer Sheet Script' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setScriptChoice(item.id)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                      scriptChoice === item.id
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopyScript()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  {copiedCode ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  <span>{copiedCode ? 'Copied' : 'Copy Code'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadScript}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Download {activeScriptFilename}</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3 text-xs">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                <p className="font-semibold text-slate-900">Gateway_Code.gs</p>
                <p className="mt-1 text-slate-600">
                  Handles Meta Webhook verification, inbound customer messages + Drive archival of customer images/PDFs/videos/audio, 6-digit OTP login, Receipt Bot, <span className="font-mono">#opt_out</span>, and exact template dispatch.
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                <p className="font-semibold text-slate-900">Worker_Code.gs</p>
                <p className="mt-1 text-slate-600">
                  Runs 1-minute chunked <span className="font-mono">Bulk_Queue</span> dispatch, 30,000-row auto-sharding into <span className="font-mono">Shards_Registry</span>, and 14-day rolling Drive backups.
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                <p className="font-semibold text-slate-900">Zero Hardcoded Keys</p>
                <p className="mt-1 text-slate-600">
                  All secrets & IDs (<span className="font-mono">WHATSAPP_ACCESS_TOKEN</span>, <span className="font-mono">WHATSAPP_PHONE_ID</span>, <span className="font-mono">WHATSAPP_WABA_ID</span>, <span className="font-mono">WEBHOOK_VERIFY_TOKEN</span>, <span className="font-mono">SPREADSHEET_ID</span>) load from Apps Script <span className="font-mono">ScriptProperties</span>.
                </p>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-950">
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2 text-xs text-slate-400">
                <span className="font-mono text-emerald-400">{activeScriptFilename}</span>
                <span className="font-mono">Google Apps Script V8 · Meta API v25.0</span>
              </div>
              <pre className="max-h-96 overflow-auto p-4 font-mono text-xs leading-relaxed text-slate-200">
                <code>{activeScriptCode}</code>
              </pre>
            </div>
          </section>
        )}

        {/* TAB 2: Complete Start-to-End Setup Guide (Printable PDF) */}
        {activeTab === 'guide' && (
          <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-[#075E54]">
                  <BookOpen className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    Complete Step-by-Step Setup & Deployment Manual (PDF)
                  </h2>
                  <p className="mt-1 text-xs text-slate-600 max-w-2xl">
                    Full start-to-end documentation covering Google Drive folder setup, Master 8-tab Google Sheet creation, Apps Script Gateway & Worker deployment, Script Properties, Meta Cloud API & Webhook configuration, External Receipt Sheets, and free GitHub Pages / Netlify hosting.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleOpenSetupGuidePdf}
                className="inline-flex items-center gap-2 rounded-lg bg-[#075E54] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#064c44] whitespace-nowrap"
              >
                <BookOpen className="h-4 w-4" />
                <span>Open Setup Guide (PDF)</span>
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4 text-xs">
              {[
                {
                  step: 'Step 1–2',
                  title: 'Drive, Master Sheet & Meta Token',
                  desc: 'Google Drive folder & 8-tab Master Sheet auto-detected from Gateway URL, Permanent System User Token & Live Mode.',
                },
                {
                  step: 'Step 3–4',
                  title: 'Dual Apps Script Deployment',
                  desc: 'Deploy Gateway_Code.gs as Web App (Anyone access), configure all 7 Script Properties, and install Worker_Code.gs 1-min trigger.',
                },
                {
                  step: 'Step 5–6',
                  title: 'Meta Webhooks & Receipt Sheets',
                  desc: 'Configure WhatsApp Business Account webhooks with unified v25.0 version & connect external auto-receipt Google Sheets.',
                },
                {
                  step: 'Step 7–8',
                  title: 'Free Static Hosting & Security',
                  desc: 'Deploy zero-cost frontend on GitHub Pages or Netlify, 3 authorized OTP admin numbers & password-protected Admin sections.',
                },
              ].map((card) => (
                <div key={card.step} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="font-mono text-[11px] font-bold text-[#075E54]">{card.step}</p>
                  <p className="mt-1 font-semibold text-slate-900">{card.title}</p>
                  <p className="mt-1.5 text-slate-600 leading-relaxed">{card.desc}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* TAB 2: Linked External Sheets (Full Add / Edit / Delete CRUD) */}
        {activeTab === 'sheets' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <form
              onSubmit={handleSaveSheetForm}
              className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-5 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">
                  {editingSheetId ? 'Edit Linked External Sheet' : 'Link New External Google Sheet'}
                </h2>
                {editingSheetId && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingSheetId(null);
                      setSheetLabel('');
                      setSheetIdInput('');
                    }}
                    className="text-xs text-slate-500 hover:text-slate-900"
                  >
                    Cancel Edit
                  </button>
                )}
              </div>

              <div>
                <label htmlFor="dev-sheet-label" className="block text-xs font-medium text-slate-700">
                  Sheet Label
                </label>
                <input
                  id="dev-sheet-label"
                  type="text"
                  required
                  value={sheetLabel}
                  onChange={(e) => setSheetLabel(e.target.value)}
                  placeholder="e.g. Retailer Receipts Google Sheet"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[#075E54] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="dev-sheet-id" className="block text-xs font-medium text-slate-700">
                  Google Spreadsheet ID or Full URL
                </label>
                <input
                  id="dev-sheet-id"
                  type="text"
                  required
                  value={sheetIdInput}
                  onChange={(e) => setSheetIdInput(e.target.value)}
                  placeholder="Paste Google Sheet URL or Spreadsheet ID"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs focus:border-[#075E54] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="dev-sheet-tab" className="block text-xs font-medium text-slate-700">
                    Worksheet Tab Name
                  </label>
                  <input
                    id="dev-sheet-tab"
                    type="text"
                    value={sheetTabName}
                    onChange={(e) => setSheetTabName(e.target.value)}
                    placeholder="Receipt"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs focus:border-[#075E54] focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="dev-sheet-tpl" className="block text-xs font-medium text-slate-700">
                    Default Template
                  </label>
                  <input
                    id="dev-sheet-tpl"
                    type="text"
                    value={sheetTemplate}
                    onChange={(e) => setSheetTemplate(e.target.value)}
                    placeholder="retailer_receipt"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs focus:border-[#075E54] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="dev-sheet-cat" className="block text-xs font-medium text-slate-700">
                  Template Category
                </label>
                <select
                  id="dev-sheet-cat"
                  value={sheetCategory}
                  onChange={(e) => setSheetCategory(e.target.value as MessageBillingCategory)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs focus:border-[#075E54] focus:outline-none"
                >
                  <option value="UTILITY">UTILITY (Receipts & Invoices)</option>
                  <option value="MARKETING">MARKETING (Offers & Catalogs)</option>
                  <option value="AUTHENTICATION">AUTHENTICATION (OTP)</option>
                  <option value="SERVICE">SERVICE (Free 24h Window)</option>
                </select>
              </div>

              <button
                type="submit"
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#075E54] px-4 py-2 text-xs font-medium text-white hover:bg-[#064c44]"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{editingSheetId ? 'Update Linked Sheet' : 'Add Linked External Sheet'}</span>
              </button>
            </form>

            <section className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-7">
              <h2 className="text-sm font-semibold text-slate-900">
                Registered External Automation Sheets ({externalSheets.length})
              </h2>
              <div className="mt-4 divide-y divide-slate-100">
                {externalSheets.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-500">
                    No external Google Sheets linked yet. Add one using the form on the left.
                  </p>
                ) : (
                  externalSheets.map((sheet) => (
                    <div
                      key={sheet.id}
                      className="flex flex-wrap items-start justify-between gap-3 py-3.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">{sheet.label}</p>
                        <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
                          ID: {sheet.spreadsheetId} · Tab: {sheet.tabName} · Template:{' '}
                          {sheet.defaultTemplate}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-500">
                          Synced Rows: <span className="font-mono font-semibold">{sheet.totalSynced}</span>
                          {' · '}
                          Category: <span className="font-mono">{sheet.defaultCategory}</span>
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => startEditSheet(sheet)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteExternalSheet(sheet.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>Delete</span>
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}

        {/* TAB 3: Failed Messages Retry Center */}
        {activeTab === 'retry' && (
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Failed Messages Retry Center ({failedMessages.length})
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Inspect Meta API error codes (parameter mismatches, expired windows, or attachment issues) and re-dispatch with 1 click.
                </p>
              </div>
            </div>

            {failedMessages.length === 0 ? (
              <div className="p-10 text-center text-sm text-slate-500">
                Zero failed messages in the workspace ledger.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {failedMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 hover:bg-slate-50/70"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">
                          {msg.contactName}
                        </span>
                        <span className="font-mono text-xs text-slate-500">
                          {formatPhoneDisplay(msg.phone)}
                        </span>
                        {msg.templateName && (
                          <span className="font-mono text-[11px] text-[#075E54]">
                            {msg.templateName}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 truncate text-xs text-slate-600">{msg.body}</p>
                      <p className="mt-1 font-mono text-[11px] text-red-700">
                        Error: {msg.error || 'Delivery failed on Meta Cloud API'}
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={retryingId === msg.id}
                      onClick={async () => {
                        setRetryingId(msg.id);
                        try {
                          await onRetryFailedMessage(msg);
                        } finally {
                          setRetryingId(null);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#075E54] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#064c44] disabled:opacity-50 whitespace-nowrap"
                    >
                      <RotateCw
                        className={`h-3.5 w-3.5 ${retryingId === msg.id ? 'animate-spin' : ''}`}
                      />
                      <span>{retryingId === msg.id ? 'Retrying...' : 'Retry Now'}</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* TAB 4: Self-Service Receipt Bot & Automated Opt-Out Compliance */}
        {activeTab === 'bot' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-[#075E54]">
                  <Bot className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Self-Service Receipt Bot & Inbound Media Archival
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Runs automatically inside <span className="font-mono">Gateway_Code.gs</span> when customers send messages, photos, PDFs, or reply with billing keywords in English or Marathi.
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-700">Active Trigger Keywords</span>
                  <span className="font-mono font-semibold text-[#075E54]">
                    Bill · Receipt · खाते · पावती
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-700">Inbound Customer Media</span>
                  <span className="font-mono text-emerald-700">Auto-saved to Drive Attachments</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-700">Main Drive Folder ID</span>
                  <span className="font-mono text-slate-700">
                    {config.driveFolderId || 'Fetched from Gateway URL'}
                  </span>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                  <ShieldAlert className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Automated Opt-Out Compliance Engine (#opt_out)
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Customers replying <span className="font-mono font-semibold">STOP</span> or{' '}
                    <span className="font-mono font-semibold">UNSUBSCRIBE</span> are tagged{' '}
                    <span className="font-mono">#opt_out</span> and skipped automatically by{' '}
                    <span className="font-mono">Worker_Code.gs</span>.
                  </p>
                </div>
              </div>

              {optedOutContacts.length === 0 ? (
                <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
                  No contacts currently carry the <span className="font-mono">#opt_out</span> tag.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {optedOutContacts.map((c) => (
                    <div key={c.id} className="flex items-center justify-between px-4 py-2.5 text-xs">
                      <div>
                        <p className="font-semibold text-slate-900">{c.name}</p>
                        <p className="font-mono text-slate-500">{formatPhoneDisplay(c.phone)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateContact(c.id, {
                            tags: c.tags.filter((t) => t.toLowerCase() !== '#opt_out'),
                          })
                        }
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Re-Subscribe
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
