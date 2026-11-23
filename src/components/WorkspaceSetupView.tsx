import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FolderPlus,
  KeyRound,
  Lock,
  Phone,
  RefreshCw,
  ShieldCheck,
  Webhook,
} from 'lucide-react';
import type { ConfirmationRequest, WhatsAppApiStatus, WorkspaceConfig } from '../types';
import { generateGatewayAppsScriptCode } from '../utils/appsScriptTemplate';
import { pingAppsScriptWebApp } from '../services/whatsappApi';

interface WorkspaceSetupViewProps {
  config: WorkspaceConfig;
  waStatus: WhatsAppApiStatus | null;
  isSyncingLive: boolean;
  counts: {
    contacts: number;
    messages: number;
    campaigns: number;
    templates: number;
    externalSheets: number;
  };
  onProvisionWorkspace: () => Promise<void>;
  onSyncLiveWorkspace: () => Promise<void>;
  onUpdateConfig: (patch: Partial<WorkspaceConfig>) => void;
  onRequestConfirmation: (req: ConfirmationRequest) => void;
  onLockAdmin?: () => void;
}

const SCRIPT_PROPERTIES_CHECKLIST = [
  {
    key: 'DRIVE_FOLDER_ID',
    example: 'Auto-detected from Master Sheet parent folder (or paste Drive Folder ID)',
    description: 'Main Google Drive folder storing your Master Sheet, Shards, Backups & Customer Attachments.',
  },
  {
    key: 'SPREADSHEET_ID',
    example: 'Auto-created or paste your Master Sheet ID',
    description: 'Master 8-tab Google Sheet ID (Contacts, Message_Logs, Templates, Bulk_Queue, etc.).',
  },
  {
    key: 'ATTACHMENTS_FOLDER_ID',
    example: 'Auto-created by 1-Click Auto-Setup',
    description: 'Drive subfolder where customer-sent WhatsApp photos, PDFs, videos & audio are saved viewably.',
  },
  {
    key: 'WHATSAPP_ACCESS_TOKEN',
    example: 'Permanent System User Token (EAAG...)',
    description: 'Never stored in GitHub or frontend — stays strictly encrypted inside Google Apps Script Properties.',
  },
  {
    key: 'WHATSAPP_PHONE_ID',
    example: 'Your Meta WhatsApp Phone Number ID',
    description: 'Used by Gateway_Code.gs to send messages and download inbound customer media from Meta.',
  },
  {
    key: 'WHATSAPP_WABA_ID',
    example: 'Your Meta WhatsApp Business Account ID',
    description: 'Used to sync live Pre-Approved Templates and submit new template applications to Meta.',
  },
  {
    key: 'WEBHOOK_VERIFY_TOKEN',
    example: 'Custom secret string matching Meta Webhooks',
    description: 'Validated during Meta Webhook GET verification handshake (hub.verify_token).',
  },
];

const META_WEBHOOK_FIELDS_MATRIX: Array<{
  field: string;
  action: 'SUBSCRIBE' | 'UNSUBSCRIBED';
  version: string;
  reason: string;
}> = [
  {
    field: 'messages',
    action: 'SUBSCRIBE',
    version: 'v25.0 (Match All)',
    reason: 'REQUIRED: Receives customer texts, images, PDFs, videos, audio, and live sent/delivered/read/failed receipts.',
  },
  {
    field: 'message_template_status_update',
    action: 'SUBSCRIBE',
    version: 'v25.0 (Match All)',
    reason: 'REQUIRED: Real-time approval, rejection, or pause notifications for your WhatsApp templates.',
  },
  {
    field: 'message_template_components_update',
    action: 'SUBSCRIBE',
    version: 'v25.0 (Match All)',
    reason: 'RECOMMENDED: Tracks changes to approved template headers, body parameters, or buttons.',
  },
  {
    field: 'message_template_quality_update',
    action: 'SUBSCRIBE',
    version: 'v25.0 (Match All)',
    reason: 'RECOMMENDED: Alerts if a template quality score drops to Yellow or Red.',
  },
  {
    field: 'template_category_update',
    action: 'SUBSCRIBE',
    version: 'v25.0 (Match All)',
    reason: 'RECOMMENDED: Alerts when Meta re-categorizes a template (e.g., Utility -> Marketing).',
  },
  {
    field: 'phone_number_quality_update',
    action: 'SUBSCRIBE',
    version: 'v25.0 (Match All)',
    reason: 'REQUIRED: Alerts on GREEN / YELLOW / RED rating changes and messaging tier upgrades.',
  },
  {
    field: 'phone_number_name_update',
    action: 'SUBSCRIBE',
    version: 'v25.0 (Match All)',
    reason: 'RECOMMENDED: Notifies when Meta approves or rejects your WhatsApp Business display name.',
  },
  {
    field: 'account_alerts',
    action: 'SUBSCRIBE',
    version: 'v25.0 (Match All)',
    reason: 'RECOMMENDED: Important WABA policy or billing warnings.',
  },
  {
    field: 'account_update',
    action: 'SUBSCRIBE',
    version: 'v25.0 (Match All)',
    reason: 'RECOMMENDED: Business verification, ban/restriction, and tier updates.',
  },
  {
    field: 'account_review_update',
    action: 'SUBSCRIBE',
    version: 'v25.0 (Match All)',
    reason: 'RECOMMENDED: Commerce / account policy review decisions.',
  },
  {
    field: 'business_capability_update',
    action: 'SUBSCRIBE',
    version: 'v25.0 (Match All)',
    reason: 'RECOMMENDED: Max daily conversations per phone number updates.',
  },
  {
    field: 'security',
    action: 'SUBSCRIBE',
    version: 'v25.0 (Match All)',
    reason: 'RECOMMENDED: Security and two-step verification alerts on your WhatsApp number.',
  },
  {
    field: 'calls, flows, groups_*, history, smb_*, standby, tracking_events, user_preferences, payment_configuration_update, account_settings_update, automatic_events, business_status_update, business_username_updates, message_echoes, message_handovers, partner_solutions',
    action: 'UNSUBSCRIBED',
    version: 'Leave Off',
    reason: 'Not needed for Cloud API messaging CRM. Keeping these Unsubscribed reduces unnecessary Apps Script executions.',
  },
];

export function WorkspaceSetupView({
  config,
  waStatus,
  isSyncingLive,
  counts,
  onProvisionWorkspace,
  onSyncLiveWorkspace,
  onUpdateConfig,
  onRequestConfirmation,
  onLockAdmin,
}: WorkspaceSetupViewProps) {
  const [copiedScript, setCopiedScript] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [copiedFolder, setCopiedFolder] = useState(false);
  const [scriptUrlDraft, setScriptUrlDraft] = useState(config.appsScriptWebAppUrl);
  const [pingResult, setPingResult] = useState<string>('');
  const [isPinging, setIsPinging] = useState(false);

  // Zero keys/IDs embedded in generated script — reads strictly from Script Properties
  const generatedScript = useMemo(
    () =>
      generateGatewayAppsScriptCode({
        folderId: config.driveFolderId,
        businessName: config.businessName,
        apiVersion: waStatus?.apiVersion || 'v25.0',
      }),
    [config.driveFolderId, config.businessName, waStatus?.apiVersion]
  );

  const handleProvisionClick = () => {
    onRequestConfirmation({
      title: 'Initialize 8-Tab Master Google Sheet & Drive Folders?',
      description:
        'Calls run_initial_setup on your Google Apps Script Master Gateway to verify or create the SNC WhatsApp Master Sheet and Attachments subfolder inside your Main Google Drive Folder.',
      details: [
        `Main Drive Folder ID: ${config.driveFolderId || 'Auto-detected from Gateway Script'}`,
        'Tabs: Contacts, Message_Logs, Campaigns, Templates, Config, Bulk_Queue, Connected_Sheets, Shards_Registry',
        'Zero API keys stored in frontend — credentials read strictly from Apps Script Script Properties.',
      ],
      confirmLabel: 'Initialize via Gateway',
      onConfirm: onProvisionWorkspace,
    });
  };

  const handleCopyScript = async () => {
    await navigator.clipboard.writeText(generatedScript);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2000);
  };

  const handleDownloadScript = () => {
    const blob = new Blob([generatedScript], { type: 'text/javascript;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Gateway_Code.gs';
    a.click();
    URL.revokeObjectURL(url);
  };

  const recommendedCallbackUrl = scriptUrlDraft.trim();

  const handleCopyWebhook = async () => {
    if (!recommendedCallbackUrl) return;
    await navigator.clipboard.writeText(recommendedCallbackUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
  };

  const handleCopyFolderId = async () => {
    if (!config.driveFolderId) return;
    await navigator.clipboard.writeText(config.driveFolderId);
    setCopiedFolder(true);
    setTimeout(() => setCopiedFolder(false), 2000);
  };

  const handleTestAppsScript = async () => {
    setPingResult('');
    const trimmed = scriptUrlDraft.trim();
    onUpdateConfig({
      appsScriptWebAppUrl: trimmed,
    });
    if (!trimmed) {
      setPingResult('Enter your deployed Master Gateway Web App (/exec) URL first.');
      return;
    }
    setIsPinging(true);
    try {
      const res = await pingAppsScriptWebApp(trimmed);
      if (res.ok) {
        const d = res.data || {};
        const fetchedFolderId = typeof d.driveFolderId === 'string' ? d.driveFolderId : '';
        const nextPatch: Partial<WorkspaceConfig> = {
          appsScriptWebAppUrl: trimmed,
          spreadsheetId: typeof d.spreadsheetId === 'string' ? d.spreadsheetId : '',
          spreadsheetUrl: typeof d.spreadsheetUrl === 'string' ? d.spreadsheetUrl : '',
          driveFolderId: fetchedFolderId,
          driveFolderUrl:
            typeof d.driveFolderUrl === 'string' && d.driveFolderUrl
              ? d.driveFolderUrl
              : fetchedFolderId
                ? `https://drive.google.com/drive/folders/${fetchedFolderId}`
                : '',
          attachmentsFolderId:
            typeof d.attachmentsFolderId === 'string' ? d.attachmentsFolderId : '',
          phoneId: typeof d.phoneId === 'string' ? d.phoneId : '',
          wabaId: typeof d.wabaId === 'string' ? d.wabaId : '',
          lastSyncedAt: new Date().toISOString(),
        };
        if (typeof d.displayPhoneNumber === 'string' && d.displayPhoneNumber) {
          nextPatch.displayPhoneNumber = d.displayPhoneNumber;
        }
        if (typeof d.businessName === 'string' && d.businessName) {
          nextPatch.businessName = d.businessName;
        }
        onUpdateConfig(nextPatch);
        setPingResult(
          `Connected (HTTP ${res.statusCode || 200}) — Sheet, Drive Folder & Script IDs fetched automatically.`
        );
        await onSyncLiveWorkspace();
      } else {
        setPingResult(res.error || 'Could not verify Gateway Web App URL.');
      }
    } finally {
      setIsPinging(false);
    }
  };

  const schemaRows = [
    {
      tab: 'Contacts',
      purpose: 'Customer profiles, E.164 phones, tags (#opt_out), merge fields, per-contact Drive URL',
      rows: counts.contacts,
    },
    {
      tab: 'Message_Logs',
      purpose: 'Unified 22-column log of Web App, External Receipt Sheets, and inbound customer messages + Drive attachment URLs',
      rows: counts.messages,
    },
    {
      tab: 'Campaigns',
      purpose: 'Bulk broadcast audit trail, recipient counts, sent/delivered/failed totals',
      rows: counts.campaigns,
    },
    {
      tab: 'Templates',
      purpose: 'Strictly pre-approved Meta WhatsApp templates synced via /{WABA_ID}/message_templates?status=APPROVED',
      rows: counts.templates,
    },
    {
      tab: 'Config',
      purpose: 'Workspace display preferences, Drive folder ID & quota settings',
      rows: 10,
    },
    {
      tab: 'Bulk_Queue',
      purpose: 'Background dispatch queue processed automatically every 1 minute by Worker_Code.gs',
      rows: 0,
    },
    {
      tab: 'Connected_Sheets',
      purpose: 'Registry of external receipt & template Google Sheets auto-aggregated into Dashboard & Reports',
      rows: counts.externalSheets,
    },
    {
      tab: 'Shards_Registry',
      purpose: 'Auto-sharding archive index created whenever Message_Logs exceeds 30,000 rows (zero data loss)',
      rows: 1,
    },
  ];

  return (
    <div className="h-full overflow-y-auto bg-slate-50 px-4 py-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Settings & Webhooks
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Manage your Master Gateway endpoint, workspace folder links, and Meta Webhook subscriptions.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="https://business.facebook.com/latest/billing_hub/payment_activity"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <span>Meta Billing Hub</span>
              <ExternalLink className="h-3.5 w-3.5 text-[#075E54]" />
            </a>
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

        {/* Live WhatsApp Business Phone Status & Quality Card */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-[#075E54]">
                <Phone className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">
                  {waStatus?.businessName || config.businessName || 'Parag Sureshrao Chaware - SNC'}
                </p>
                <p className="mt-0.5 font-mono text-xs text-slate-600">
                  {waStatus?.displayPhoneNumber || config.displayPhoneNumber || '+91 95522 33488'}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 font-semibold text-slate-800">
                <CheckCircle2
                  className={`h-3.5 w-3.5 ${
                    waStatus?.qualityRating ? 'text-emerald-600' : 'text-slate-400'
                  }`}
                />
                <span>Quality: {waStatus?.qualityRating || 'Awaiting Live Sync'}</span>
              </span>
              <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono font-semibold text-slate-700">
                Tier: {waStatus?.messagingTier || 'Awaiting Sync'}
              </span>
              <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono font-semibold text-slate-700">
                API {waStatus?.apiVersion || 'v25.0'}
              </span>
            </div>
          </div>
        </section>

        {/* 01. Google Drive Main Folder & 8-Tab Master Sheet */}
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                01. Main Google Drive Folder & 8-Tab Master Google Sheet
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                All spreadsheets, message shards, nightly backups, and inbound customer photos/PDFs live inside your Main Google Drive Folder.
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 font-mono text-xs font-semibold text-emerald-800">
              {waStatus?.configured ? 'Gateway Live' : 'Gateway Standby'}
            </span>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-5">
            <button
              type="button"
              disabled={!config.appsScriptWebAppUrl}
              onClick={handleProvisionClick}
              className="inline-flex items-center gap-2 rounded-lg bg-[#075E54] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#064c44] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
            >
              <FolderPlus className="h-4 w-4" />
              <span>1-Click Auto-Setup (8 Tabs)</span>
            </button>

            <button
              type="button"
              disabled={isSyncingLive || !config.appsScriptWebAppUrl}
              onClick={() => void onSyncLiveWorkspace()}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
            >
              <RefreshCw className={`h-4 w-4 ${isSyncingLive ? 'animate-spin' : ''}`} />
              <span>{isSyncingLive ? 'Syncing Live Data...' : 'Pull Live Data from Sheet & Meta'}</span>
            </button>

            {config.driveFolderId && (
              <a
                href={
                  config.driveFolderUrl ||
                  `https://drive.google.com/drive/folders/${config.driveFolderId}`
                }
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#075E54] hover:underline whitespace-nowrap"
              >
                <span>Open Main Drive Folder</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}

            {config.spreadsheetUrl && (
              <a
                href={config.spreadsheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#075E54] hover:underline whitespace-nowrap"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                <span>Open Master Google Sheet</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-3">
            <div>
              <p className="text-[11px] font-medium text-slate-500">Main Drive Folder ID</p>
              <div className="mt-1 flex items-center gap-1.5">
                <p className="truncate font-mono text-xs font-semibold text-slate-900">
                  {config.driveFolderId || 'Fetched from Gateway URL'}
                </p>
                {config.driveFolderId && (
                  <button
                    type="button"
                    onClick={() => void handleCopyFolderId()}
                    aria-label="Copy Main Drive Folder ID"
                    className="rounded border border-slate-200 bg-white p-1 text-slate-600 hover:bg-slate-100"
                  >
                    {copiedFolder ? (
                      <Check className="h-3 w-3 text-emerald-600" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </button>
                )}
              </div>
            </div>
            <div>
              <p className="text-[11px] font-medium text-slate-500">Active Master Spreadsheet</p>
              <p className="mt-1 truncate font-mono text-xs text-slate-900">
                {config.spreadsheetId || 'Fetched from Gateway URL'}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-medium text-slate-500">Last Synced</p>
              <p className="mt-1 font-mono text-xs text-slate-900 tabular-nums">
                {config.lastSyncedAt
                  ? new Date(config.lastSyncedAt).toLocaleString()
                  : 'Pending live sync'}
              </p>
            </div>
          </div>

          {/* 8-Tab Sheet Schema Table */}
          <div className="mt-5 overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 font-medium text-slate-500">
                  <th className="px-4 py-2.5">Worksheet Tab (8-Tab Schema)</th>
                  <th className="px-4 py-2.5">Stored Data & Architecture Role</th>
                  <th className="px-4 py-2.5 text-right">Current Rows</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {schemaRows.map((row) => (
                  <tr key={row.tab}>
                    <td className="px-4 py-2.5 font-mono font-semibold text-[#075E54]">
                      {row.tab}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{row.purpose}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-900 tabular-nums">
                      {row.rows}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 02. Apps Script Gateway URL & Script Properties Checklist (Zero Keys in Frontend) */}
        <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-[#075E54]">
                <KeyRound className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  02. Apps Script Gateway URL & Script Properties (Zero Hardcoded Secrets)
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Store all Meta API tokens, Phone ID, WABA ID, Spreadsheet ID, and Verify Token ONLY inside Google Apps Script → <strong>Project Settings → Script Properties</strong>. Only your deployed <span className="font-mono text-xs">/exec</span> Web App URL is entered here.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCopyScript()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                {copiedScript ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                <span>{copiedScript ? 'Copied Gateway_Code.gs' : 'Copy Gateway_Code.gs'}</span>
              </button>
              <button
                type="button"
                onClick={handleDownloadScript}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Download Gateway_Code.gs</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="md:col-span-9">
              <label
                htmlFor="apps-script-url-input"
                className="block text-xs font-medium text-slate-700"
              >
                Deployed Master Gateway Web App URL (/exec)
              </label>
              <input
                id="apps-script-url-input"
                type="url"
                value={scriptUrlDraft}
                onChange={(e) => setScriptUrlDraft(e.target.value)}
                placeholder="https://script.google.com/macros/s/AKfycb.../exec"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs focus:border-[#075E54] focus:outline-none"
              />
            </div>

            <div className="flex items-end md:col-span-3">
              <button
                type="button"
                disabled={isPinging}
                onClick={() => void handleTestAppsScript()}
                className="w-full rounded-lg bg-[#075E54] px-4 py-2 text-xs font-medium text-white hover:bg-[#064c44] whitespace-nowrap"
              >
                {isPinging ? 'Testing...' : 'Save & Test Endpoint'}
              </button>
            </div>
          </div>
          {pingResult && <p className="text-xs font-medium text-slate-700">{pingResult}</p>}

          {/* Script Properties Checklist Table */}
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 font-medium text-slate-500">
                  <th className="px-4 py-2.5">Apps Script Property Key</th>
                  <th className="px-4 py-2.5">Expected Value</th>
                  <th className="px-4 py-2.5">Purpose</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {SCRIPT_PROPERTIES_CHECKLIST.map((prop) => (
                  <tr key={prop.key}>
                    <td className="px-4 py-2.5 font-mono font-semibold text-[#075E54] whitespace-nowrap">
                      {prop.key}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-slate-700">
                      {prop.example}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{prop.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-950">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2 text-xs text-slate-400">
              <span className="inline-flex items-center gap-1.5 font-mono">
                <Code2 className="h-3.5 w-3.5 text-emerald-400" />
                <span>Gateway_Code.gs</span>
              </span>
              <span className="font-mono">Google Apps Script · V8 · Inbound Media Drive Archival Ready</span>
            </div>
            <pre className="max-h-56 overflow-auto p-4 font-mono text-xs leading-relaxed text-slate-200">
              <code>{generatedScript}</code>
            </pre>
          </div>
        </section>

        {/* 03. Complete Meta Webhook Setup Guide & Field Subscription Matrix */}
        <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-[#075E54]">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  03. Complete Meta Webhook Setup & Field Subscription Guide
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Follow these exact 4 steps inside Meta for Developers so customer messages, photos, PDFs, and delivery ticks arrive live in your Team Inbox and Google Drive.
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={!recommendedCallbackUrl}
              onClick={() => void handleCopyWebhook()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
            >
              {copiedWebhook ? (
                <Check className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              <span>{copiedWebhook ? 'Copied Callback URL' : 'Copy Callback URL (/exec)'}</span>
            </button>
          </div>

          {/* Critical 4-Point Troubleshooting & Setup Checklist */}
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950 space-y-2">
            <div className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" />
              <span>Critical Meta Developer Portal Requirements (Must Check All 4)</span>
            </div>
            <ol className="list-decimal space-y-1.5 pl-5 leading-relaxed">
              <li>
                <strong>Switch App Mode to LIVE:</strong> At the top of Meta for Developers, toggle{' '}
                <span className="font-mono font-semibold">App Mode: Development → Live</span>. Meta blocks ALL real customer messages and real delivery webhooks while an app is in Development mode.
              </li>
              <li>
                <strong>Use WhatsApp Business Account (NOT User):</strong> Open{' '}
                <span className="font-mono font-semibold">WhatsApp → Configuration</span> (or{' '}
                <span className="font-mono font-semibold">Webhooks → WhatsApp Business Account</span> from the dropdown). Never configure under <span className="font-mono">Webhooks → User</span>.
              </li>
              <li>
                <strong>Match Callback URL & Verify Token:</strong> Paste your deployed{' '}
                <span className="font-mono font-semibold">Gateway_Code.gs (/exec)</span> URL as Callback URL, and enter the exact <span className="font-mono font-semibold">WEBHOOK_VERIFY_TOKEN</span> stored in your Apps Script Script Properties. Ensure Apps Script deployment has <strong>Execute as: Me</strong> and <strong>Who has access: Anyone</strong>.
              </li>
              <li>
                <strong>Use ONE Unified Graph API Version Across All Subscribed Fields:</strong> Set every subscribed field below to the same API version (e.g., <span className="font-mono font-semibold">v25.0</span> or <span className="font-mono font-semibold">v21.0</span>) — mixing v21.0 and v27.0 can drop payloads.
              </li>
            </ol>
          </div>

          {/* Exact Meta Webhook Fields Table */}
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                <Webhook className="h-3.5 w-3.5 text-[#075E54]" />
                <span>Meta Webhook Fields Matrix (WhatsApp Business Account)</span>
              </span>
              <span className="font-mono text-[11px] text-slate-500">
                Inbound photos/PDFs auto-archive to Drive
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-white font-medium text-slate-500">
                    <th className="px-4 py-2.5">Webhook Field</th>
                    <th className="px-3 py-2.5">Setting</th>
                    <th className="px-3 py-2.5">Version</th>
                    <th className="px-4 py-2.5">Role in SNC WhatsApp Suite</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {META_WEBHOOK_FIELDS_MATRIX.map((row) => (
                    <tr key={row.field}>
                      <td className="px-4 py-2.5 font-mono font-semibold text-slate-900">
                        {row.field}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span
                          className={`inline-block rounded px-2 py-0.5 font-mono text-[11px] font-semibold ${
                            row.action === 'SUBSCRIBE'
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : 'bg-slate-100 text-slate-600 border border-slate-200'
                          }`}
                        >
                          {row.action === 'SUBSCRIBE' ? 'Subscribed' : 'Unsubscribed'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                        {row.version}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{row.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 pt-2">
            <div>
              <label
                htmlFor="default-cc-input"
                className="block text-xs font-medium text-slate-700"
              >
                Default Dialing Country Code
              </label>
              <input
                id="default-cc-input"
                type="text"
                value={config.defaultCountryCode}
                onChange={(e) =>
                  onUpdateConfig({
                    defaultCountryCode: e.target.value.replace(/\D/g, '').slice(0, 4),
                  })
                }
                className="mt-1 w-32 rounded-lg border border-slate-200 px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-[#075E54] focus:outline-none"
              />
            </div>

            <label className="flex items-center gap-2.5 self-end pb-1.5 text-xs font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={config.autoLogToSheets}
                onChange={(e) => onUpdateConfig({ autoLogToSheets: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 accent-[#075E54]"
              />
              <span>Auto-append outbound messages to Message_Logs</span>
            </label>
          </div>
        </section>
      </div>
    </div>
  );
}
