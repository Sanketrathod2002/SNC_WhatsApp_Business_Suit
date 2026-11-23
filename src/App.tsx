import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileSpreadsheet, Lock, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import type {
  Attachment,
  AuthSession,
  Campaign,
  ChatMessage,
  ConfirmationRequest,
  Contact,
  DriveFileItem,
  ExternalSheetSource,
  MessageBillingCategory,
  MessageTemplate,
  NavSection,
  WhatsAppApiStatus,
  WorkspaceConfig,
} from './types';
import {
  INITIAL_CAMPAIGNS,
  INITIAL_CONTACTS,
  INITIAL_DRIVE_FILES,
  INITIAL_EXTERNAL_SHEETS,
  INITIAL_MESSAGES,
  INITIAL_TEMPLATES,
  INITIAL_WORKSPACE_CONFIG,
} from './data/seedData';
import {
  deleteDriveFileViaGateway,
  exportReportViaAppsScript,
  fetchAppsScriptIncomingMessages,
  fetchLiveWorkspaceBootstrap,
  fetchWhatsAppStatus,
  importContactsViaGateway,
  listDriveFilesViaGateway,
  logoutViaGateway,
  queueBulkCampaignOnGateway,
  registerAuthExpiredHandler,
  runGatewayAutoSetup,
  sendWhatsAppViaServer,
  setActiveGatewaySessionToken,
  submitNewMetaTemplate,
  syncContactToGateway,
  syncMetaTemplatesLive,
  triggerExternalSheetsSyncViaAppsScript,
  uploadDriveFileViaGateway,
} from './services/whatsappApi';
import {
  dedupeMessages,
  inferAttachmentKind,
  normalizePhone,
  renderMessageTemplate,
  resolveRecipientAttachment,
  verifySecurityPinHash,
} from './utils/whatsappLogic';
import {
  DEFAULT_PRICING_RATES,
  inferMessageCategory,
} from './utils/analyticsLogic';
import { SidebarNav } from './components/SidebarNav';
import { DashboardView } from './components/DashboardView';
import { TeamInboxView } from './components/TeamInboxView';
import {
  BulkBroadcastView,
  type BulkDispatchControl,
  type BulkExecutionRowResult,
} from './components/BulkBroadcastView';
import { ContactsView } from './components/ContactsView';
import { TemplatesMediaView } from './components/TemplatesMediaView';
import { ReportsAndSheetsView } from './components/ReportsAndSheetsView';
import { WorkspaceSetupView } from './components/WorkspaceSetupView';
import { DeveloperToolsView } from './components/DeveloperToolsView';
import { LoginGate } from './components/LoginGate';
import { ConfirmDialog } from './components/ConfirmDialog';

const LEGACY_STORAGE_KEY = 'snc_whatsapp_workspace_v1';
const STORAGE_KEY = 'snc_whatsapp_live_v2';
const LEGACY_SESSION_STORAGE_KEY = 'snc_auth_session';

interface PersistedWorkspaceState {
  contacts: Contact[];
  messages: ChatMessage[];
  templates: MessageTemplate[];
  campaigns: Campaign[];
  driveFiles: DriveFileItem[];
  externalSheets: ExternalSheetSource[];
  config: WorkspaceConfig;
}

function purgeLegacySessionStorage(): void {
  try {
    window.sessionStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

function normalizeOutboundAttachmentName(att?: Attachment | null): string | undefined {
  if (!att) return undefined;
  const raw = (att.name || '').trim().replace(/\.bin$/i, '');
  if (att.kind === 'document') {
    if (!raw) return 'SNC_Document.pdf';
    return /\.[a-zA-Z0-9]{2,5}$/.test(raw) ? raw : `${raw}.pdf`;
  }
  return raw || undefined;
}

function loadInitialState(): PersistedWorkspaceState {
  try {
    // Purge legacy dummy storage key so zero stale seed records ever surface
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);

    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedWorkspaceState>;
      const rawCfg = parsed.config || ({} as Partial<WorkspaceConfig>);
      const configuredGatewayUrl = (
        rawCfg.appsScriptWebAppUrl ||
        INITIAL_WORKSPACE_CONFIG.appsScriptWebAppUrl ||
        ''
      ).trim();
      const hasGatewayUrl = configuredGatewayUrl.length > 0;
      const mergedConfig: WorkspaceConfig = {
        ...INITIAL_WORKSPACE_CONFIG,
        ...rawCfg,
        appsScriptWebAppUrl: configuredGatewayUrl,
        spreadsheetId: hasGatewayUrl ? rawCfg.spreadsheetId || '' : '',
        spreadsheetUrl: hasGatewayUrl ? rawCfg.spreadsheetUrl || '' : '',
        driveFolderId: hasGatewayUrl ? rawCfg.driveFolderId || '' : '',
        driveFolderUrl: hasGatewayUrl ? rawCfg.driveFolderUrl || '' : '',
        attachmentsFolderId: hasGatewayUrl ? rawCfg.attachmentsFolderId || '' : '',
        wabaId: rawCfg.wabaId || INITIAL_WORKSPACE_CONFIG.wabaId,
        phoneId: rawCfg.phoneId || INITIAL_WORKSPACE_CONFIG.phoneId,
        displayPhoneNumber:
          rawCfg.displayPhoneNumber || INITIAL_WORKSPACE_CONFIG.displayPhoneNumber,
        dailyQuotaCap: rawCfg.dailyQuotaCap || INITIAL_WORKSPACE_CONFIG.dailyQuotaCap,
        pricing: {
          ...DEFAULT_PRICING_RATES,
          ...(rawCfg.pricing || {}),
        },
        upi: {
          vpa: rawCfg.upi?.vpa || INITIAL_WORKSPACE_CONFIG.upi?.vpa || 'snc.parag@upi',
          payeeName:
            rawCfg.upi?.payeeName ||
            INITIAL_WORKSPACE_CONFIG.upi?.payeeName ||
            'Parag Sureshrao Chaware SNC',
          defaultNote:
            rawCfg.upi?.defaultNote ||
            INITIAL_WORKSPACE_CONFIG.upi?.defaultNote ||
            'SNC Invoice Payment',
        },
      };
      return {
        contacts: Array.isArray(parsed.contacts) ? parsed.contacts : INITIAL_CONTACTS,
        messages: Array.isArray(parsed.messages)
          ? dedupeMessages(parsed.messages)
          : INITIAL_MESSAGES,
        templates: Array.isArray(parsed.templates) ? parsed.templates : INITIAL_TEMPLATES,
        campaigns: Array.isArray(parsed.campaigns) ? parsed.campaigns : INITIAL_CAMPAIGNS,
        driveFiles: Array.isArray(parsed.driveFiles) ? parsed.driveFiles : INITIAL_DRIVE_FILES,
        externalSheets:
          Array.isArray(parsed.externalSheets) && parsed.externalSheets.length > 0
            ? parsed.externalSheets
            : INITIAL_EXTERNAL_SHEETS,
        config: mergedConfig,
      };
    }
  } catch {
    // Fallback to clean zero-dummy initial state
  }
  return {
    contacts: INITIAL_CONTACTS,
    messages: INITIAL_MESSAGES,
    templates: INITIAL_TEMPLATES,
    campaigns: INITIAL_CAMPAIGNS,
    driveFiles: INITIAL_DRIVE_FILES,
    externalSheets: INITIAL_EXTERNAL_SHEETS,
    config: INITIAL_WORKSPACE_CONFIG,
  };
}

const SECTION_LABELS: Record<NavSection, string> = {
  dashboard: 'Dashboard',
  inbox: 'Inbox',
  broadcast: 'Broadcast',
  contacts: 'Contacts',
  templates: 'Templates',
  reports: 'Reports',
  workspace: 'Settings',
  admin_dev: 'Developer',
};

const STATUS_RANK: Record<string, number> = {
  queued: 0,
  failed: 1,
  sent: 2,
  delivered: 3,
  read: 4,
};

export default function App() {
  const initial = useMemo(() => loadInitialState(), []);
  // Hold OTP sessionToken strictly in React memory (never persisted in localStorage or sessionStorage)
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [activeSection, setActiveSection] = useState<NavSection>('dashboard');
  const [contacts, setContacts] = useState<Contact[]>(initial.contacts);
  const [messages, setMessages] = useState<ChatMessage[]>(initial.messages);
  const [templates, setTemplates] = useState<MessageTemplate[]>(initial.templates);
  const [campaigns, setCampaigns] = useState<Campaign[]>(initial.campaigns);
  const [driveFiles, setDriveFiles] = useState<DriveFileItem[]>(initial.driveFiles);
  const [externalSheets, setExternalSheets] = useState<ExternalSheetSource[]>(
    initial.externalSheets
  );
  const [config, setConfig] = useState<WorkspaceConfig>(initial.config);

  const [selectedContactId, setSelectedContactId] = useState<string | null>(
    initial.contacts[0]?.id || null
  );
  const [waStatus, setWaStatus] = useState<WhatsAppApiStatus | null>(null);
  const [isSyncingLive, setIsSyncingLive] = useState(false);
  const [isSyncingExternal, setIsSyncingExternal] = useState(false);

  // Password lock protecting Settings & Developer sections (password: 2026)
  const [adminSectionUnlocked, setAdminSectionUnlocked] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [adminPasswordError, setAdminPasswordError] = useState('');

  const [confirmRequest, setConfirmRequest] = useState<ConfirmationRequest | null>(null);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const lastWebhookCursorRef = useRef<string>('');
  const processedWebhookIdsRef = useRef<Set<string>>(
    new Set(
      initial.messages.flatMap((m) => (m.waMessageId ? [m.id, m.waMessageId] : [m.id]))
    )
  );
  const contactsRef = useRef<Contact[]>(contacts);
  contactsRef.current = contacts;

  const runtimeConfig = useMemo(
    () => ({
      appsScriptWebAppUrl: config.appsScriptWebAppUrl,
      appsScriptApiKey: config.appsScriptApiKey,
      wabaId: config.wabaId,
      sessionToken: authSession?.sessionToken || '',
    }),
    [config.appsScriptWebAppUrl, config.appsScriptApiKey, config.wabaId, authSession?.sessionToken]
  );

  const showBanner = useCallback((text: string) => {
    setBannerMessage(text);
    setTimeout(() => {
      setBannerMessage((curr) => (curr === text ? null : curr));
    }, 4800);
  }, []);

  const handleAuthenticated = (session: AuthSession) => {
    setActiveGatewaySessionToken(session.sessionToken);
    setAuthSession(session);
  };

  const handleSignOutSession = useCallback(() => {
    void logoutViaGateway(runtimeConfig);
    setActiveGatewaySessionToken('');
    purgeLegacySessionStorage();
    setAuthSession(null);
    setAdminSectionUnlocked(false);
    setAdminPasswordInput('');
    setAdminPasswordError('');
    setActiveSection('dashboard');
  }, [runtimeConfig]);

  useEffect(() => {
    purgeLegacySessionStorage();
  }, []);

  useEffect(() => {
    registerAuthExpiredHandler(() => {
      setAuthSession(null);
      setAdminSectionUnlocked(false);
      setActiveSection('dashboard');
    });
    return () => registerAuthExpiredHandler(null);
  }, []);

  const handleUnlockAdminSection = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminPasswordError('');
    const valid = await verifySecurityPinHash(adminPasswordInput);
    if (valid) {
      setAdminSectionUnlocked(true);
      setAdminPasswordInput('');
    } else {
      setAdminPasswordError('Incorrect password. Please try again.');
    }
  };

  // Persist live synced workspace data locally across refreshes
  useEffect(() => {
    try {
      const payload: PersistedWorkspaceState = {
        contacts,
        messages,
        templates,
        campaigns,
        driveFiles,
        externalSheets,
        config,
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage quota errors
    }
  }, [contacts, messages, templates, campaigns, driveFiles, externalSheets, config]);

  // Pull live status + live workspace data from Master Sheet, Drive & Meta Cloud API
  const handleSyncLiveWorkspace = useCallback(
    async (silent = false) => {
      if (!runtimeConfig.appsScriptWebAppUrl) {
        if (!silent) {
          showBanner('Configure your Master Gateway URL in Settings & Webhooks first.');
        }
        return;
      }

      setIsSyncingLive(true);
      try {
        const [statusRes, bootRes] = await Promise.all([
          fetchWhatsAppStatus(runtimeConfig),
          fetchLiveWorkspaceBootstrap(runtimeConfig),
        ]);
        setWaStatus(statusRes);

        if (bootRes.ok) {
          const nextMessages = dedupeMessages(bootRes.messages || []);
          const nextAllTemplates = bootRes.templates || [];

          // Build contacts map merged with any message senders
          const contactMap = new Map<string, Contact>();
          for (const c of bootRes.contacts || []) {
            const norm = normalizePhone(c.phone, config.defaultCountryCode) || c.phone;
            contactMap.set(norm, { ...c, phone: norm });
          }
          for (const m of nextMessages) {
            const norm = normalizePhone(m.phone, config.defaultCountryCode) || m.phone;
            const existing = contactMap.get(norm);
            if (existing) {
              if (!existing.lastMessageAt || m.timestamp > existing.lastMessageAt) {
                contactMap.set(norm, {
                  ...existing,
                  lastMessagePreview: m.body || existing.lastMessagePreview,
                  lastMessageAt: m.timestamp,
                });
              }
            } else {
              contactMap.set(norm, {
                id: m.contactId || `cnt_${norm}`,
                name: m.contactName || `WhatsApp ${norm.slice(-4)}`,
                phone: norm,
                email: '',
                company: '',
                tags: [m.direction === 'inbound' ? 'Inbound' : m.sourceSheet || 'WhatsApp'],
                status: 'open',
                assignedAgent: authSession?.name || 'Parag Sureshrao Chaware',
                custom1: m.receiptNo || '',
                custom2: '',
                attachmentUrl: m.attachment?.url || '',
                attachmentName: m.attachment?.name || '',
                notes: '',
                unreadCount: 0,
                lastMessagePreview: m.body,
                lastMessageAt: m.timestamp,
              });
            }
          }

          const mergedContacts = Array.from(contactMap.values());
          setContacts(mergedContacts);
          setMessages(nextMessages);
          setCampaigns(bootRes.campaigns || []);
          setDriveFiles(bootRes.driveFiles || []);
          setTemplates(nextAllTemplates);

          if (!selectedContactId && mergedContacts[0]) {
            setSelectedContactId(mergedContacts[0].id);
          }

          for (const m of nextMessages) {
            processedWebhookIdsRef.current.add(m.id);
            if (m.waMessageId) processedWebhookIdsRef.current.add(m.waMessageId);
          }

          setConfig((prev) => ({
            ...prev,
            displayPhoneNumber:
              bootRes.phoneProfile?.displayPhoneNumber ||
              statusRes.displayPhoneNumber ||
              prev.displayPhoneNumber,
            businessName:
              bootRes.phoneProfile?.verifiedName ||
              statusRes.businessName ||
              prev.businessName,
            spreadsheetId: bootRes.spreadsheetId || prev.spreadsheetId,
            spreadsheetUrl: bootRes.spreadsheetUrl || prev.spreadsheetUrl,
            driveFolderId: bootRes.driveFolderId || prev.driveFolderId,
            driveFolderUrl:
              bootRes.driveFolderUrl ||
              (bootRes.driveFolderId
                ? `https://drive.google.com/drive/folders/${bootRes.driveFolderId}`
                : prev.driveFolderUrl),
            attachmentsFolderId: bootRes.attachmentsFolderId || prev.attachmentsFolderId,
            phoneId: bootRes.phoneId || prev.phoneId,
            wabaId: bootRes.wabaId || prev.wabaId,
            lastSyncedAt: new Date().toISOString(),
          }));

          if (!silent) {
            showBanner(
              `Sync complete: ${mergedContacts.length} contacts, ${nextMessages.length} logs, ${nextAllTemplates.length} templates.`
            );
          }
        } else {
          const tplRes = await syncMetaTemplatesLive(runtimeConfig);
          if (tplRes.ok) {
            setTemplates(tplRes.templates);
          }
          if (!silent) {
            showBanner(
              bootRes.error ||
                'Connected. Redeploy the latest Gateway script from Developer to enable full workspace sync.'
            );
          }
        }
      } finally {
        setIsSyncingLive(false);
      }
    },
    [
      runtimeConfig,
      config.defaultCountryCode,
      authSession?.name,
      selectedContactId,
      showBanner,
    ]
  );

  // Auto-sync live status & data immediately upon login
  useEffect(() => {
    if (!authSession) return;
    void handleSyncLiveWorkspace(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authSession, config.appsScriptWebAppUrl]);

  // Poll live inbound customer messages + real Meta delivery/read/failed status receipts every 6 seconds
  useEffect(() => {
    if (!authSession || !config.appsScriptWebAppUrl) return;
    const timer = window.setInterval(async () => {
      try {
        const events = await fetchAppsScriptIncomingMessages(
          config.appsScriptWebAppUrl,
          lastWebhookCursorRef.current || undefined,
          config.appsScriptApiKey || '',
          authSession.sessionToken
        );
        if (events.length === 0) return;

        for (const evt of events) {
          const eventCursor = evt.readAt || evt.deliveredAt || evt.receivedAt;
          if (
            eventCursor &&
            (!lastWebhookCursorRef.current ||
              new Date(eventCursor).getTime() >
                new Date(lastWebhookCursorRef.current).getTime())
          ) {
            lastWebhookCursorRef.current = eventCursor;
          }

          // Update status accurately on any already-tracked outbound message
          if (evt.waMessageId && evt.status) {
            setMessages((prev) => {
              let changed = false;
              const next = prev.map((m) => {
                if (m.waMessageId !== evt.waMessageId && m.id !== evt.id) return m;
                const incomingRank = STATUS_RANK[evt.status!] ?? 0;
                const currentRank = STATUS_RANK[m.status] ?? 0;
                const shouldUpdateStatus =
                  incomingRank > currentRank ||
                  (evt.status === 'failed' && m.status !== 'failed');
                if (!shouldUpdateStatus && !evt.error) return m;
                changed = true;
                return {
                  ...m,
                  status: shouldUpdateStatus ? evt.status! : m.status,
                  deliveredAt:
                    evt.deliveredAt ||
                    (evt.status === 'delivered' || evt.status === 'read'
                      ? m.deliveredAt || evt.receivedAt
                      : m.deliveredAt),
                  readAt:
                    evt.readAt ||
                    (evt.status === 'read' ? m.readAt || evt.receivedAt : m.readAt),
                  error: evt.error || m.error,
                };
              });
              return changed ? next : prev;
            });
          }

          if (
            processedWebhookIdsRef.current.has(evt.id) ||
            (evt.waMessageId && processedWebhookIdsRef.current.has(evt.waMessageId))
          ) {
            continue;
          }
          processedWebhookIdsRef.current.add(evt.id);
          if (evt.waMessageId) {
            processedWebhookIdsRef.current.add(evt.waMessageId);
          }

          if (evt.kind === 'external_outbound' && evt.from) {
            const rawPhone = String(evt.from);
            const normalizedPhone =
              normalizePhone(rawPhone, config.defaultCountryCode) || rawPhone;
            const existingContact = contactsRef.current.find(
              (c) =>
                c.phone === normalizedPhone ||
                normalizePhone(c.phone, config.defaultCountryCode) === normalizedPhone
            );
            const resolvedContactId = existingContact
              ? existingContact.id
              : `cnt_${normalizedPhone}`;

            const categoryUpper = String(evt.category || 'UTILITY').toUpperCase();
            const validCategory: MessageBillingCategory =
              categoryUpper === 'MARKETING' ||
              categoryUpper === 'AUTHENTICATION' ||
              categoryUpper === 'SERVICE'
                ? categoryUpper
                : 'UTILITY';

            const extMsg: ChatMessage = {
              id: evt.id,
              contactId: resolvedContactId,
              phone: normalizedPhone,
              contactName: evt.contactName || existingContact?.name || normalizedPhone,
              direction: 'outbound',
              type: evt.attachmentUrl
                ? inferAttachmentKind('', evt.attachmentName || evt.attachmentUrl)
                : evt.templateName
                  ? 'template'
                  : 'text',
              body: evt.body,
              attachment: evt.attachmentUrl
                ? {
                    id: `att-${evt.id}`,
                    kind: inferAttachmentKind('', evt.attachmentName || evt.attachmentUrl),
                    name: evt.attachmentName || 'Attachment',
                    mimeType: 'application/pdf',
                    url: evt.attachmentUrl,
                  }
                : undefined,
              templateName: evt.templateName || undefined,
              campaignId: evt.campaignId || undefined,
              status: evt.status || 'sent',
              waMessageId: evt.waMessageId || undefined,
              timestamp: evt.receivedAt,
              sourceSheet: evt.sourceSheet || 'External Sheet',
              category: validCategory,
              receiptNo: evt.receiptNo || undefined,
              deliveredAt:
                evt.deliveredAt ||
                (evt.status === 'delivered' || evt.status === 'read'
                  ? evt.receivedAt
                  : undefined),
              readAt: evt.readAt || (evt.status === 'read' ? evt.receivedAt : undefined),
              error: evt.error || undefined,
              billable: evt.status !== 'failed' && validCategory !== 'SERVICE',
            };

            setMessages((prev) => dedupeMessages([...prev, extMsg]));
          } else if (evt.kind === 'message' && evt.from) {
            const rawFrom = String(evt.from);
            const normalizedFrom =
              normalizePhone(rawFrom, config.defaultCountryCode) || rawFrom;
            const existingContact = contactsRef.current.find(
              (c) =>
                c.phone === normalizedFrom ||
                normalizePhone(c.phone, config.defaultCountryCode) === normalizedFrom
            );
            const resolvedContactId = existingContact
              ? existingContact.id
              : `cnt_${normalizedFrom}`;

            setContacts((prev) => {
              const existing = prev.find(
                (c) =>
                  c.id === resolvedContactId ||
                  c.phone === normalizedFrom ||
                  normalizePhone(c.phone, config.defaultCountryCode) === normalizedFrom
              );
              if (existing) {
                return prev.map((c) =>
                  c.id === existing.id
                    ? {
                        ...c,
                        unreadCount: c.unreadCount + 1,
                        lastMessagePreview: evt.body,
                        lastMessageAt: evt.receivedAt,
                        status: 'open',
                      }
                    : c
                );
              }
              return [
                {
                  id: resolvedContactId,
                  name: evt.contactName || `WhatsApp ${normalizedFrom.slice(-4)}`,
                  phone: normalizedFrom,
                  email: '',
                  company: '',
                  tags: ['Inbound'],
                  status: 'open',
                  assignedAgent: authSession.name,
                  custom1: '',
                  custom2: '',
                  attachmentUrl: '',
                  attachmentName: '',
                  notes: '',
                  unreadCount: 1,
                  lastMessagePreview: evt.body,
                  lastMessageAt: evt.receivedAt,
                },
                ...prev,
              ];
            });

            const inboundKind = evt.attachmentUrl
              ? evt.messageType === 'image' ||
                evt.messageType === 'video' ||
                evt.messageType === 'audio' ||
                evt.messageType === 'document'
                ? evt.messageType
                : inferAttachmentKind('', evt.attachmentName || evt.attachmentUrl)
              : 'text';

            setMessages((prev) =>
              dedupeMessages([
                ...prev,
                {
                  id: evt.id,
                  contactId: resolvedContactId,
                  phone: normalizedFrom,
                  contactName: evt.contactName || existingContact?.name || normalizedFrom,
                  direction: 'inbound',
                  type: inboundKind,
                  body: evt.body,
                  attachment: evt.attachmentUrl
                    ? {
                        id: `in-att-${evt.id}`,
                        kind:
                          inboundKind === 'text'
                            ? inferAttachmentKind('', evt.attachmentName || evt.attachmentUrl)
                            : inboundKind,
                        name: evt.attachmentName || 'Customer Attachment',
                        mimeType:
                          inboundKind === 'image'
                            ? 'image/jpeg'
                            : inboundKind === 'video'
                              ? 'video/mp4'
                              : inboundKind === 'audio'
                                ? 'audio/ogg'
                                : 'application/pdf',
                        url: evt.attachmentUrl,
                      }
                    : undefined,
                  status: 'delivered',
                  waMessageId: evt.waMessageId,
                  timestamp: evt.receivedAt,
                  sourceSheet: 'WhatsApp Inbound',
                  category: 'SERVICE',
                },
              ])
            );
          }
        }
      } catch {
        // Ignore transient poll hiccups
      }
    }, 6000);

    return () => window.clearInterval(timer);
  }, [authSession, config.appsScriptWebAppUrl, config.appsScriptApiKey, config.defaultCountryCode]);

  const unreadTotal = useMemo(
    () => contacts.reduce((sum, c) => sum + c.unreadCount, 0),
    [contacts]
  );

  // Enforce Passwordless OTP / PIN Security Gate
  if (!authSession) {
    return (
      <LoginGate
        config={config}
        onUpdateConfig={(patch) => setConfig((prev) => ({ ...prev, ...patch }))}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  const handleSelectContact = (contactId: string) => {
    setSelectedContactId(contactId);
    setContacts((prev) =>
      prev.map((c) => (c.id === contactId ? { ...c, unreadCount: 0 } : c))
    );
  };

  const handleProvisionWorkspace = async () => {
    const res = await runGatewayAutoSetup(runtimeConfig);
    if (res.ok) {
      setConfig((prev) => ({
        ...prev,
        spreadsheetId: res.spreadsheetId || prev.spreadsheetId,
        spreadsheetUrl: res.spreadsheetUrl || prev.spreadsheetUrl,
        driveFolderId: res.driveFolderId || prev.driveFolderId,
        lastSyncedAt: new Date().toISOString(),
      }));
      showBanner('Initialized 8-tab Master Google Sheet & Drive Attachments folder via Gateway.');
      await handleSyncLiveWorkspace(true);
    } else {
      showBanner(res.error || 'Unable to initialize Master Sheet via Gateway.');
    }
  };

  const handleMergeContacts = (incoming: Contact[]) => {
    setContacts((prev) => {
      const byPhone = new Map(prev.map((c) => [c.phone, c]));
      for (const item of incoming) {
        if (!byPhone.has(item.phone)) {
          byPhone.set(item.phone, item);
        }
      }
      return Array.from(byPhone.values());
    });
  };

  const handleImportFromGoogleSheet = async (sheetUrlOrId: string): Promise<number> => {
    const res = await importContactsViaGateway(runtimeConfig, sheetUrlOrId);
    if (!res.ok) {
      throw new Error(
        res.error ||
          'Unable to import contacts from Google Sheet via Gateway. Verify Sheet sharing & Gateway URL.'
      );
    }
    if (res.contacts.length > 0) {
      handleMergeContacts(res.contacts);
    }
    return res.contacts.length;
  };

  const handleSyncAllExternalSheets = async () => {
    setIsSyncingExternal(true);
    try {
      if (!config.appsScriptWebAppUrl) {
        showBanner('Configure your Apps Script Master Gateway URL in Settings first.');
        return;
      }
      const res = await triggerExternalSheetsSyncViaAppsScript(runtimeConfig);
      if (res.ok) {
        await handleSyncLiveWorkspace(true);
        showBanner(
          `Synced ${res.syncedCount ?? 0} new row(s) across ${res.sheetsProcessed ?? externalSheets.length} external Google Sheet(s).`
        );
      } else {
        showBanner(res.error || 'External Google Sheets sync failed.');
      }
    } finally {
      setIsSyncingExternal(false);
    }
  };

  const handleExportReportToSheet = async (
    title: string,
    rows: string[][]
  ): Promise<string | null> => {
    if (!config.appsScriptWebAppUrl) {
      throw new Error(
        'Connect your Apps Script Master Gateway URL in Settings to save reports directly to Google Sheets.'
      );
    }
    const res = await exportReportViaAppsScript(runtimeConfig, title, rows);
    if (res.ok && res.spreadsheetUrl) {
      showBanner(`Saved report "${title}" to Google Drive.`);
      return res.spreadsheetUrl;
    }
    throw new Error(res.error || 'Apps Script report export failed.');
  };

  const handleSyncMetaTemplates = async (): Promise<{
    ok: boolean;
    count: number;
    message: string;
  }> => {
    const res = await syncMetaTemplatesLive(runtimeConfig);
    if (!res.ok) {
      return {
        ok: false,
        count: 0,
        message:
          res.error ||
          'Verify WHATSAPP_ACCESS_TOKEN and WHATSAPP_WABA_ID in Apps Script Properties to sync live pre-approved templates.',
      };
    }

    setTemplates(res.templates);

    const approvedCount = res.templates.filter((t) => t.status === 'APPROVED').length;
    const msg = `Synced ${res.templates.length} template(s) (${approvedCount} approved).`;
    showBanner(msg);
    return { ok: true, count: res.templates.length, message: msg };
  };

  const handleSubmitMetaTemplate = async (
    draft: MessageTemplate,
    metaPayload: Record<string, unknown>
  ): Promise<{ ok: boolean; message: string }> => {
    const res = await submitNewMetaTemplate(metaPayload, runtimeConfig);
    if (!res.ok) {
      return {
        ok: false,
        message: res.error || 'Meta rejected the template submission. Check WABA ID & fields.',
      };
    }

    const msg = `Submitted "${draft.name}" to Meta Cloud API (ID: ${
      res.metaTemplateId || 'Pending'
    }, Status: ${res.status || 'PENDING'}). It will appear in your live list once Meta approves it.`;
    showBanner(msg);
    return { ok: true, message: msg };
  };

  const handleUploadFileToDrive = async (file: File): Promise<DriveFileItem | null> => {
    if (!config.appsScriptWebAppUrl) {
      showBanner('Configure your Master Gateway URL in Settings to upload to Google Drive.');
      return null;
    }
    const uploaded = await uploadDriveFileViaGateway(runtimeConfig, file);
    if (uploaded.ok && uploaded.file) {
      const item: DriveFileItem = {
        ...uploaded.file,
        kind: inferAttachmentKind(uploaded.file.mimeType, uploaded.file.name),
      };
      setDriveFiles((prev) => [item, ...prev]);
      showBanner(`Uploaded "${item.name}" to SNC Google Drive.`);
      return item;
    }
    showBanner(uploaded.error || 'Google Drive upload failed via Gateway.');
    return null;
  };

  const handleRefreshDriveFiles = async () => {
    const res = await listDriveFilesViaGateway(runtimeConfig);
    if (res.ok) {
      setDriveFiles(res.files);
      showBanner(`Loaded ${res.files.length} file(s) from Google Drive.`);
    } else {
      showBanner(res.error || 'Unable to list Google Drive files via Gateway.');
    }
  };

  const handleDeleteDriveFile = async (file: DriveFileItem) => {
    const res = await deleteDriveFileViaGateway(runtimeConfig, file.id);
    if (!res.ok) {
      showBanner(res.error || 'Unable to delete file from Google Drive.');
      return;
    }
    setDriveFiles((prev) => prev.filter((f) => f.id !== file.id));
    showBanner(`Moved "${file.name}" to Google Drive trash.`);
  };

  const handleSendMessage = async (params: {
    contact: Contact;
    body: string;
    attachment?: Attachment;
    templateName?: string;
    templateLanguage?: string;
    templateParams?: string[];
    templateHeaderType?: 'NONE' | 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'VIDEO';
    templateHeaderParams?: string[];
    templateButtonParams?: string[];
    localFile?: File;
    campaignId?: string;
  }) => {
    const {
      contact,
      body,
      attachment,
      templateName,
      templateLanguage,
      templateParams,
      templateHeaderType,
      templateHeaderParams,
      templateButtonParams,
      localFile,
      campaignId,
    } = params;

    let resolvedAttachment = attachment;
    if (localFile && (!attachment || !attachment.url.startsWith('https://'))) {
      const uploaded = await handleUploadFileToDrive(localFile);
      if (uploaded) {
        resolvedAttachment = {
          id: uploaded.id,
          kind: uploaded.kind,
          name: uploaded.name,
          mimeType: uploaded.mimeType,
          url: uploaded.downloadUrl,
          sizeBytes: uploaded.sizeBytes,
          driveFileId: uploaded.id,
          metaMediaId: uploaded.metaMediaId,
        };
      }
    }

    // CRITICAL: Check templateName BEFORE resolvedAttachment so templates with PDF/Image/Video headers send as 'template'
    const messageType = templateName
      ? 'template'
      : resolvedAttachment
        ? resolvedAttachment.kind
        : 'text';

    const matchedTemplate = templateName
      ? templates.find((t) => t.name === templateName && t.status === 'APPROVED')
      : undefined;
    const category: MessageBillingCategory = matchedTemplate
      ? matchedTemplate.category
      : templateName
        ? 'UTILITY'
        : 'SERVICE';

    const sendRes = await sendWhatsAppViaServer(
      {
        to: contact.phone,
        contactName: contact.name,
        type: messageType,
        body,
        templateName: matchedTemplate?.name || templateName,
        templateLanguage: templateLanguage || matchedTemplate?.language,
        templateParams,
        templateHeaderType: templateHeaderType || matchedTemplate?.headerType,
        templateHeaderParams,
        templateButtonParams,
        attachmentUrl:
          resolvedAttachment && resolvedAttachment.url.startsWith('https://')
            ? resolvedAttachment.url
            : undefined,
        attachmentName: normalizeOutboundAttachmentName(resolvedAttachment),
        mediaId: resolvedAttachment?.metaMediaId || undefined,
        campaignId,
        category,
        sourceSheet: 'SNC Web App',
      },
      runtimeConfig
    );

    const nowIso = new Date().toISOString();
    // Mark strictly 'sent' on dispatch; 'delivered' and 'read' are upgraded ONLY by live Meta webhook receipts
    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      contactId: contact.id,
      phone: contact.phone,
      contactName: contact.name,
      direction: 'outbound',
      type: messageType,
      body,
      attachment: resolvedAttachment,
      templateName: matchedTemplate?.name || templateName,
      campaignId,
      status: sendRes.ok ? 'sent' : 'failed',
      waMessageId: sendRes.waMessageId,
      timestamp: nowIso,
      error: sendRes.ok ? undefined : sendRes.error,
      sourceSheet: 'SNC Web App',
      category,
      billable: sendRes.ok && category !== 'SERVICE',
    };

    processedWebhookIdsRef.current.add(newMsg.id);
    if (newMsg.waMessageId) {
      processedWebhookIdsRef.current.add(newMsg.waMessageId);
    }
    setMessages((prev) => dedupeMessages([...prev, newMsg]));
    setContacts((prev) =>
      prev.map((c) =>
        c.id === contact.id
          ? {
              ...c,
              lastMessagePreview:
                body || (resolvedAttachment ? `Sent ${resolvedAttachment.name}` : ''),
              lastMessageAt: nowIso,
            }
          : c
      )
    );

    if (!sendRes.ok) {
      showBanner(`Message to ${contact.name} failed: ${sendRes.error}`);
    }
  };

  const handleRetryFailedMessage = async (msg: ChatMessage) => {
    const targetContact: Contact = contacts.find(
      (c) => c.id === msg.contactId || c.phone === msg.phone
    ) || {
      id: msg.contactId,
      name: msg.contactName,
      phone: msg.phone,
      email: '',
      company: '',
      tags: [],
      status: 'open',
      assignedAgent: authSession.name,
      custom1: '',
      custom2: '',
      attachmentUrl: msg.attachment?.url || '',
      attachmentName: msg.attachment?.name || '',
      notes: '',
      unreadCount: 0,
      lastMessagePreview: msg.body,
      lastMessageAt: msg.timestamp,
    };

    await handleSendMessage({
      contact: targetContact,
      body: msg.body,
      attachment: msg.attachment,
      templateName: msg.templateName,
    });
    showBanner(`Retried message to ${targetContact.name}.`);
  };

  const handleStartNewChat = async (params: {
    name: string;
    phone: string;
    company: string;
    initialMessage: string;
  }) => {
    const existing = contacts.find((c) => c.phone === params.phone);
    let targetContact: Contact;

    if (existing) {
      targetContact = existing;
    } else {
      targetContact = {
        id: `cnt_${params.phone}`,
        name: params.name,
        phone: params.phone,
        email: '',
        company: params.company,
        tags: ['New Chat'],
        status: 'open',
        assignedAgent: authSession.name,
        custom1: '',
        custom2: '',
        attachmentUrl: '',
        attachmentName: '',
        notes: '',
        unreadCount: 0,
        lastMessagePreview: params.initialMessage,
        lastMessageAt: new Date().toISOString(),
      };
      setContacts((prev) => [targetContact, ...prev]);
      if (config.appsScriptWebAppUrl) {
        syncContactToGateway(
          runtimeConfig,
          'save_contact',
          targetContact as unknown as Record<string, unknown>
        ).catch(() => {});
      }
    }

    setSelectedContactId(targetContact.id);
    await handleSendMessage({
      contact: targetContact,
      body: params.initialMessage,
    });
  };

  const handleQueueBulkCampaign = async (params: {
    campaignName: string;
    recipients: Contact[];
    messageTemplate: string;
    templateName: string;
    attachmentMode: 'none' | 'shared' | 'per-contact';
    sharedAttachment: Attachment | null;
  }): Promise<{ ok: boolean; queuedCount: number; message: string }> => {
    const campaignId = `cmp-q-${Date.now()}`;
    const queueRows = params.recipients.map((recipient) => {
      const renderedBody = renderMessageTemplate(params.messageTemplate, recipient);
      const att = resolveRecipientAttachment(
        params.attachmentMode,
        params.sharedAttachment,
        recipient
      );
      return {
        phone: recipient.phone,
        name: recipient.name,
        message: renderedBody,
        attachmentUrl: att?.url?.startsWith('https://') ? att.url : undefined,
        attachmentName: att?.name,
      };
    });

    const res = await queueBulkCampaignOnGateway(runtimeConfig, {
      campaignId,
      campaignName: params.campaignName,
      templateName: params.templateName,
      rows: queueRows,
    });

    if (!res.ok) {
      const errMsg = res.error || 'Failed to queue campaign to Master Sheet Bulk_Queue.';
      showBanner(errMsg);
      return { ok: false, queuedCount: 0, message: errMsg };
    }

    const queuedCampaign: Campaign = {
      id: campaignId,
      name: params.campaignName,
      createdAt: new Date().toISOString(),
      totalRecipients: params.recipients.length,
      sent: 0,
      delivered: 0,
      failed: 0,
      templateName: params.templateName,
      messagePreview: params.messageTemplate.slice(0, 96),
      attachmentMode: params.attachmentMode,
      attachmentName:
        params.attachmentMode === 'per-contact'
          ? 'Per-Contact Sheet Column'
          : params.sharedAttachment?.name,
      attachmentUrl: params.sharedAttachment?.url,
      status: 'queued',
    };
    setCampaigns((prev) => [queuedCampaign, ...prev]);

    const queuedCount = res.queuedCount ?? params.recipients.length;
    const message = `Queued ${queuedCount} row(s) to Master Sheet Bulk_Queue. Worker_Code.gs will dispatch automatically every 1 minute.`;
    showBanner(message);
    return { ok: true, queuedCount, message };
  };

  const handleRunBulkCampaign = async (params: {
    campaignName: string;
    recipients: Contact[];
    messageTemplate: string;
    templateName: string;
    attachmentMode: 'none' | 'shared' | 'per-contact';
    sharedAttachment: Attachment | null;
    delayMs: number;
    controlRef: { current: BulkDispatchControl };
    resolveTemplateParams?: (contact: Contact) => {
      bodyParams: string[];
      headerParams: string[];
      buttonParams: string[];
      headerType?: 'NONE' | 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'VIDEO';
      language?: string;
    };
    onProgress: (stats: {
      processed: number;
      sent: number;
      failed: number;
      rowResult?: BulkExecutionRowResult;
    }) => void;
  }): Promise<Campaign> => {
    const campaignId = `cmp-${Date.now()}`;
    let sent = 0;
    let failed = 0;

    handleMergeContacts(params.recipients);
    const matchedTpl = templates.find(
      (t) => t.name === params.templateName && t.status === 'APPROVED'
    );

    for (let i = 0; i < params.recipients.length; i++) {
      while (params.controlRef.current.paused && !params.controlRef.current.stopped) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (params.controlRef.current.stopped) {
        break;
      }

      const recipient = params.recipients[i];
      if (recipient.tags.includes('#opt_out')) {
        params.onProgress({
          processed: i + 1,
          sent,
          failed,
          rowResult: {
            name: recipient.name,
            phone: recipient.phone,
            status: 'skipped',
            error: 'Skipped (#opt_out compliance)',
            timestamp: new Date().toISOString(),
          },
        });
        continue;
      }

      const renderedBody = renderMessageTemplate(params.messageTemplate, recipient);
      const resolvedAttachment = resolveRecipientAttachment(
        params.attachmentMode,
        params.sharedAttachment,
        recipient
      );

      const isTemplateDispatch = Boolean(
        params.templateName && params.templateName !== 'custom_broadcast'
      );
      const resolvedTplParams =
        isTemplateDispatch && params.resolveTemplateParams
          ? params.resolveTemplateParams(recipient)
          : undefined;
      const dispatchType = isTemplateDispatch
        ? 'template'
        : resolvedAttachment
          ? resolvedAttachment.kind
          : 'text';

      const category: MessageBillingCategory = matchedTpl
        ? matchedTpl.category
        : inferMessageCategory({
            id: '',
            contactId: recipient.id,
            phone: recipient.phone,
            contactName: recipient.name,
            direction: 'outbound',
            type: dispatchType,
            body: renderedBody,
            templateName: isTemplateDispatch ? params.templateName : undefined,
            status: 'sent',
            timestamp: '',
          });

      const res = await sendWhatsAppViaServer(
        {
          to: recipient.phone,
          contactName: recipient.name,
          type: dispatchType,
          body: renderedBody,
          templateName: isTemplateDispatch ? params.templateName : undefined,
          templateLanguage: resolvedTplParams?.language || matchedTpl?.language,
          templateParams: resolvedTplParams?.bodyParams,
          templateHeaderType: resolvedTplParams?.headerType || matchedTpl?.headerType,
          templateHeaderParams: resolvedTplParams?.headerParams,
          templateButtonParams: resolvedTplParams?.buttonParams,
          attachmentUrl:
            resolvedAttachment && resolvedAttachment.url.startsWith('https://')
              ? resolvedAttachment.url
              : undefined,
          attachmentName: normalizeOutboundAttachmentName(resolvedAttachment),
          mediaId: resolvedAttachment?.metaMediaId || undefined,
          campaignId,
          category,
          sourceSheet: 'SNC Web App',
        },
        runtimeConfig
      );

      const nowIso = new Date().toISOString();
      if (res.ok) {
        sent++;
      } else {
        failed++;
      }

      const logEntry: ChatMessage = {
        id: `msg-cmp-${Date.now()}-${i}`,
        contactId: recipient.id,
        phone: recipient.phone,
        contactName: recipient.name,
        direction: 'outbound',
        type: dispatchType,
        body: renderedBody,
        attachment: resolvedAttachment || undefined,
        templateName: isTemplateDispatch ? params.templateName : undefined,
        campaignId,
        status: res.ok ? 'sent' : 'failed',
        waMessageId: res.waMessageId,
        timestamp: nowIso,
        error: res.ok ? undefined : res.error,
        sourceSheet: 'SNC Web App',
        category,
        billable: res.ok && category !== 'SERVICE',
      };

      processedWebhookIdsRef.current.add(logEntry.id);
      if (logEntry.waMessageId) {
        processedWebhookIdsRef.current.add(logEntry.waMessageId);
      }
      setMessages((prev) => dedupeMessages([...prev, logEntry]));
      setContacts((prev) =>
        prev.map((c) =>
          c.phone === recipient.phone
            ? {
                ...c,
                lastMessagePreview: renderedBody || resolvedAttachment?.name || '',
                lastMessageAt: nowIso,
              }
            : c
        )
      );

      params.onProgress({
        processed: i + 1,
        sent,
        failed,
        rowResult: {
          name: recipient.name,
          phone: recipient.phone,
          status: res.ok ? 'sent' : 'failed',
          error: res.ok ? undefined : res.error,
          timestamp: nowIso,
        },
      });

      if (i < params.recipients.length - 1 && params.delayMs > 0) {
        const waitMs = Math.min(params.delayMs, 5000);
        const step = 100;
        for (let elapsed = 0; elapsed < waitMs; elapsed += step) {
          if (params.controlRef.current.stopped) break;
          await new Promise((resolve) => setTimeout(resolve, step));
        }
      }
    }

    const completedCampaign: Campaign = {
      id: campaignId,
      name: params.campaignName,
      createdAt: new Date().toISOString(),
      totalRecipients: params.recipients.length,
      sent,
      delivered: 0,
      failed,
      templateName: params.templateName,
      messagePreview: params.messageTemplate.slice(0, 96),
      attachmentMode: params.attachmentMode,
      attachmentName:
        params.attachmentMode === 'per-contact'
          ? 'Per-Contact Sheet Column'
          : params.sharedAttachment?.name,
      attachmentUrl: params.sharedAttachment?.url,
      status: params.controlRef.current.stopped
        ? 'partial'
        : failed === 0
          ? 'completed'
          : sent > 0
            ? 'partial'
            : 'failed',
    };

    setCampaigns((prev) => [completedCampaign, ...prev]);
    showBanner(`Campaign "${completedCampaign.name}" finished: ${sent} sent, ${failed} failed.`);
    return completedCampaign;
  };

  const gatewayConfigured = Boolean(config.appsScriptWebAppUrl);
  const gatewayOnline = Boolean(waStatus?.configured);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50 text-slate-900">
      {/* Always Left-Side Navigation Bar (Desktop Sidebar + Mobile Left Icon Rail & Drawer) */}
      <SidebarNav
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        unreadTotal={unreadTotal}
        gatewayOnline={gatewayOnline}
        adminLocked={!adminSectionUnlocked}
        session={authSession}
        onSignOut={handleSignOutSession}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Clean Contextual Top Bar */}
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="truncate font-semibold tracking-tight text-slate-900">
              {SECTION_LABELS[activeSection]}
            </span>
            {(waStatus?.displayPhoneNumber || config.displayPhoneNumber) && (
              <>
                <span className="hidden text-slate-300 lg:inline" aria-hidden="true">
                  ·
                </span>
                <span className="hidden font-mono text-xs text-slate-500 lg:inline whitespace-nowrap">
                  {waStatus?.displayPhoneNumber || config.displayPhoneNumber}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={isSyncingLive || !gatewayConfigured}
              onClick={() => void handleSyncLiveWorkspace(false)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 text-[#075E54] ${isSyncingLive ? 'animate-spin' : ''}`}
              />
              <span className="hidden sm:inline">
                {isSyncingLive ? 'Syncing...' : 'Sync Live Data'}
              </span>
            </button>

            {activeSection !== 'workspace' && !gatewayConfigured && (
              <button
                type="button"
                onClick={() => setActiveSection('workspace')}
                className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-[#075E54]" />
                <span>Connect Gateway</span>
              </button>
            )}

            {activeSection !== 'broadcast' && authSession.role !== 'AGENT' && (
              <button
                type="button"
                onClick={() => setActiveSection('broadcast')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#075E54] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#064c44] whitespace-nowrap shrink-0"
              >
                <Send className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">New Broadcast</span>
                <span className="sm:hidden">Bulk</span>
              </button>
            )}
          </div>
        </header>

        {/* Active Workspace Viewport */}
        <main className="relative min-h-0 flex-1 overflow-hidden">
          {activeSection === 'dashboard' && (
            <DashboardView
              messages={messages}
              externalSheets={externalSheets}
              onNavigate={setActiveSection}
              onSyncExternalSheets={handleSyncAllExternalSheets}
              onSyncLiveWorkspace={() => handleSyncLiveWorkspace(false)}
              isSyncingExternal={isSyncingExternal}
              isSyncingLive={isSyncingLive}
            />
          )}

          {activeSection === 'inbox' && (
            <TeamInboxView
              contacts={contacts}
              messages={messages}
              templates={templates}
              driveFiles={driveFiles}
              selectedContactId={selectedContactId}
              defaultCountryCode={config.defaultCountryCode}
              gatewayConfigured={gatewayConfigured}
              onSelectContact={handleSelectContact}
              onSendMessage={handleSendMessage}
              onStartNewChat={handleStartNewChat}
              onUpdateContact={(updated) => {
                setContacts((prev) =>
                  prev.map((c) => (c.id === updated.id ? updated : c))
                );
                if (config.appsScriptWebAppUrl) {
                  syncContactToGateway(
                    runtimeConfig,
                    'save_contact',
                    updated as unknown as Record<string, unknown>
                  ).catch(() => {});
                }
              }}
              onUploadFileToDrive={handleUploadFileToDrive}
            />
          )}

          {activeSection === 'broadcast' && (
            <BulkBroadcastView
              contacts={contacts}
              messages={messages}
              templates={templates}
              campaigns={campaigns}
              driveFiles={driveFiles}
              defaultCountryCode={config.defaultCountryCode}
              rateLimitMs={config.rateLimitMs}
              dailyQuotaCap={config.dailyQuotaCap || 850}
              gatewayConfigured={gatewayConfigured}
              onImportContacts={handleMergeContacts}
              onImportFromGoogleSheet={handleImportFromGoogleSheet}
              onUploadFileToDrive={handleUploadFileToDrive}
              onSendTestMessage={handleSendMessage}
              onQueueBulkCampaign={handleQueueBulkCampaign}
              onRunBulkCampaign={handleRunBulkCampaign}
              onRequestConfirmation={setConfirmRequest}
            />
          )}

          {activeSection === 'contacts' && (
            <ContactsView
              contacts={contacts}
              defaultCountryCode={config.defaultCountryCode}
              gatewayConfigured={gatewayConfigured}
              hasMasterSheet={Boolean(config.spreadsheetId)}
              onSaveContact={(saved) => {
                setContacts((prev) => {
                  const exists = prev.some((c) => c.id === saved.id);
                  return exists
                    ? prev.map((c) => (c.id === saved.id ? saved : c))
                    : [saved, ...prev];
                });
                if (config.appsScriptWebAppUrl) {
                  syncContactToGateway(
                    runtimeConfig,
                    'save_contact',
                    saved as unknown as Record<string, unknown>
                  ).catch(() => {});
                }
              }}
              onDeleteContact={(id) => {
                const target = contacts.find((c) => c.id === id);
                setContacts((prev) => prev.filter((c) => c.id !== id));
                if (target && config.appsScriptWebAppUrl) {
                  syncContactToGateway(
                    runtimeConfig,
                    'delete_contact',
                    target as unknown as Record<string, unknown>
                  ).catch(() => {});
                }
              }}
              onImportContacts={handleMergeContacts}
              onOpenChatWithContact={(contactId) => {
                handleSelectContact(contactId);
                setActiveSection('inbox');
              }}
              onSyncContactsToSheet={() => void handleSyncLiveWorkspace(false)}
              onImportFromGoogleSheet={handleImportFromGoogleSheet}
              onRequestConfirmation={setConfirmRequest}
            />
          )}

          {activeSection === 'templates' && (
            <TemplatesMediaView
              templates={templates}
              driveFiles={driveFiles}
              gatewayConfigured={gatewayConfigured}
              hasDriveFolder={Boolean(config.driveFolderId)}
              wabaIdConfigured={Boolean(config.wabaId || waStatus?.wabaIdConfigured)}
              onSyncMetaTemplates={handleSyncMetaTemplates}
              onSubmitMetaTemplate={handleSubmitMetaTemplate}
              onUseTemplateInBroadcast={() => setActiveSection('broadcast')}
              onUploadFileToDrive={handleUploadFileToDrive}
              onRefreshDriveFiles={handleRefreshDriveFiles}
              onDeleteDriveFile={handleDeleteDriveFile}
              onRequestConfirmation={setConfirmRequest}
            />
          )}

          {activeSection === 'reports' && (
            <ReportsAndSheetsView
              messages={messages}
              externalSheets={externalSheets}
              config={config}
              onImportContacts={(imported) => {
                handleMergeContacts(imported);
                showBanner(`Imported ${imported.length} contact(s) via custom column mapping.`);
              }}
              onExportReportToSheet={handleExportReportToSheet}
              onRequestConfirmation={setConfirmRequest}
            />
          )}

          {(activeSection === 'workspace' || activeSection === 'admin_dev') &&
            !adminSectionUnlocked && (
              <div className="flex h-full items-center justify-center bg-slate-50 p-6">
                <form
                  onSubmit={(e) => void handleUnlockAdminSection(e)}
                  className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-xs space-y-5"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-[#075E54]">
                      <Lock className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-slate-900">
                        {activeSection === 'workspace' ? 'Settings' : 'Developer'} Locked
                      </h2>
                      <p className="text-xs text-slate-500">
                        Enter administrator password to unlock protected controls.
                      </p>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="admin-lock-password"
                      className="block text-xs font-medium text-slate-700"
                    >
                      Administrator Password
                    </label>
                    <input
                      id="admin-lock-password"
                      type="password"
                      inputMode="numeric"
                      autoFocus
                      autoComplete="off"
                      value={adminPasswordInput}
                      onChange={(e) => setAdminPasswordInput(e.target.value)}
                      placeholder="Enter password"
                      className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 font-mono text-sm text-slate-900 focus:border-[#075E54] focus:outline-none"
                    />
                    {adminPasswordError && (
                      <p className="mt-1.5 text-xs font-medium text-red-600" role="alert">
                        {adminPasswordError}
                      </p>
                    )}
                  </div>

                  <button
                    type="submit"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#075E54] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#064c44]"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    <span>Unlock {activeSection === 'workspace' ? 'Settings' : 'Developer'}</span>
                  </button>
                </form>
              </div>
            )}

          {activeSection === 'workspace' && adminSectionUnlocked && (
            <WorkspaceSetupView
              config={config}
              waStatus={waStatus}
              isSyncingLive={isSyncingLive}
              counts={{
                contacts: contacts.length,
                messages: messages.length,
                campaigns: campaigns.length,
                templates: templates.length,
                externalSheets: externalSheets.length,
              }}
              onProvisionWorkspace={handleProvisionWorkspace}
              onSyncLiveWorkspace={() => handleSyncLiveWorkspace(false)}
              onUpdateConfig={(patch) => setConfig((prev) => ({ ...prev, ...patch }))}
              onRequestConfirmation={setConfirmRequest}
              onLockAdmin={() => setAdminSectionUnlocked(false)}
            />
          )}

          {activeSection === 'admin_dev' && adminSectionUnlocked && (
            <DeveloperToolsView
              config={config}
              contacts={contacts}
              messages={messages}
              externalSheets={externalSheets}
              onAddExternalSheet={(sheet) => {
                setExternalSheets((prev) => [sheet, ...prev]);
                showBanner(`Linked external sheet "${sheet.label}".`);
              }}
              onUpdateExternalSheet={(id, patch) => {
                setExternalSheets((prev) =>
                  prev.map((s) => (s.id === id ? { ...s, ...patch } : s))
                );
                showBanner('Updated linked sheet settings.');
              }}
              onDeleteExternalSheet={(id) => {
                setExternalSheets((prev) => prev.filter((s) => s.id !== id));
                showBanner('Removed linked sheet.');
              }}
              onRetryFailedMessage={handleRetryFailedMessage}
              onUpdateContact={(contactId, patch) => {
                setContacts((prev) =>
                  prev.map((c) => (c.id === contactId ? { ...c, ...patch } : c))
                );
                showBanner('Updated contact compliance status.');
              }}
              onLockAdmin={() => setAdminSectionUnlocked(false)}
            />
          )}

          {bannerMessage && (
            <div
              role="status"
              aria-live="polite"
              className="fixed bottom-11 right-5 z-40 max-w-md rounded-lg border border-slate-200 bg-slate-900 px-4 py-2.5 text-xs font-medium text-white shadow-lg"
            >
              {bannerMessage}
            </div>
          )}
        </main>

        {/* Workspace Copyright Footer */}
        <footer className="flex h-8 shrink-0 items-center justify-center border-t border-slate-200 bg-white px-4 text-[11px] text-slate-500">
          &copy; 2026 QuantumDynamics Data Solution. All Rights Reserved.
        </footer>
      </div>

      <ConfirmDialog
        request={confirmRequest}
        onClose={() => setConfirmRequest(null)}
      />
    </div>
  );
}
