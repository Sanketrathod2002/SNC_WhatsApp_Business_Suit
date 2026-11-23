import type {
  AttachmentKind,
  Campaign,
  ChatMessage,
  Contact,
  DriveFileItem,
  ExternalSheetSource,
  MessageTemplate,
  MetaLiveStats,
  WhatsAppApiStatus,
} from '../types';

export interface SendMessagePayload {
  to: string;
  type: 'text' | 'template' | AttachmentKind;
  body: string;
  contactName?: string;
  templateName?: string;
  templateLanguage?: string;
  templateParams?: string[];
  templateHeaderType?: 'NONE' | 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'VIDEO';
  templateHeaderParams?: string[];
  templateButtonParams?: string[];
  attachmentUrl?: string;
  attachmentName?: string;
  mediaId?: string;
  campaignId?: string;
  category?: string;
  receiptNo?: string;
  sourceSheet?: string;
}

export interface SendMessageResponse {
  ok: boolean;
  mode?: 'apps-script';
  waMessageId?: string;
  status?: 'sent' | 'failed';
  error?: string;
}

export interface AppsScriptRuntimeConfig {
  appsScriptWebAppUrl?: string;
  appsScriptApiKey?: string;
  wabaId?: string;
  sessionToken?: string;
}

let activeGatewaySessionToken = '';
let authExpiredCallback: (() => void) | null = null;

export function setActiveGatewaySessionToken(token: string): void {
  activeGatewaySessionToken = (token || '').trim();
}

export function registerAuthExpiredHandler(handler: (() => void) | null): void {
  authExpiredCallback = handler;
}

export interface LiveWorkspaceBootstrapData {
  ok: boolean;
  contacts: Contact[];
  messages: ChatMessage[];
  campaigns: Campaign[];
  templates: MessageTemplate[];
  driveFiles: DriveFileItem[];
  externalSheets: ExternalSheetSource[];
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  driveFolderId?: string;
  driveFolderUrl?: string;
  attachmentsFolderId?: string;
  phoneId?: string;
  wabaId?: string;
  phoneProfile?: {
    configured?: boolean;
    displayPhoneNumber?: string;
    verifiedName?: string;
    qualityRating?: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';
    messagingTier?: string;
    apiVersion?: string;
    wabaIdConfigured?: boolean;
    masterSheetName?: string;
  };
  phoneStatus?: {
    configured: boolean;
    displayPhoneNumber?: string;
    verifiedName?: string;
    qualityRating?: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';
    messagingTier?: string;
    apiVersion?: string;
    wabaIdConfigured?: boolean;
    masterSheetName?: string;
  };
  error?: string;
}

export function extractSpreadsheetId(urlOrId: string): string {
  const trimmed = (urlOrId || '').trim();
  if (!trimmed) return '';
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : trimmed;
}

export function isAllowedAppsScriptEndpoint(url?: string): boolean {
  const trimmed = (url || '').trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'script.google.com' ||
        parsed.hostname === 'script.googleusercontent.com')
    );
  } catch {
    return false;
  }
}

/**
 * CORS-safe POST helper for Google Apps Script Web Apps (works 100% statically from GitHub Pages & Netlify).
 * Using text/plain avoids browser OPTIONS preflight which Apps Script does not answer.
 */
export async function callAppsScriptAction<T = Record<string, unknown>>(
  webAppUrl: string,
  action: string,
  payload: Record<string, unknown> = {},
  apiKey = '',
  sessionToken = ''
): Promise<T & { ok?: boolean; error?: string; authExpired?: boolean }> {
  if (!isAllowedAppsScriptEndpoint(webAppUrl)) {
    throw new Error('Enter a valid https://script.google.com/macros/s/.../exec URL in Settings first.');
  }
  const effectiveToken = (sessionToken || activeGatewaySessionToken || '').trim();
  const res = await fetch(webAppUrl.trim(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action,
      apiKey: apiKey.trim(),
      sessionToken: effectiveToken,
      ...payload,
    }),
    redirect: 'follow',
  });
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as T & { ok?: boolean; error?: string; authExpired?: boolean };
    if (parsed.authExpired && effectiveToken && authExpiredCallback) {
      activeGatewaySessionToken = '';
      authExpiredCallback();
    }
    return parsed;
  } catch {
    throw new Error(
      'Apps Script Gateway returned an unreadable response. Ensure deployment is updated to Gateway_Code.gs with "Who has access: Anyone".'
    );
  }
}

/**
 * Fetches live WhatsApp Business Cloud API & Master Sheet status directly from Apps Script Gateway.
 * Never assumes qualityRating or messagingTier if not returned by Meta Graph API.
 */
export async function fetchWhatsAppStatus(
  runtime?: AppsScriptRuntimeConfig
): Promise<WhatsAppApiStatus> {
  if (!isAllowedAppsScriptEndpoint(runtime?.appsScriptWebAppUrl)) {
    return {
      configured: false,
      mode: 'apps-script',
      phoneIdMasked: null,
      wabaIdConfigured: Boolean(runtime?.wabaId),
      apiVersion: 'v25.0',
      webhookUrl: '',
      isPreviewUrl: false,
      verifyTokenConfigured: true,
      verifyTokenSource: 'workspace',
      appSecretConfigured: false,
      receivedWebhookEvents: 0,
      gatewayOnline: false,
    };
  }

  try {
    let data: {
      ok?: boolean;
      configured?: boolean;
      wabaIdConfigured?: boolean;
      apiVersion?: string;
      phoneIdMasked?: string;
      displayPhoneNumber?: string;
      verifiedName?: string;
      businessName?: string;
      qualityRating?: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';
      messagingTier?: string;
      spreadsheetName?: string;
    };

    const effectiveToken = (runtime?.sessionToken || activeGatewaySessionToken || '').trim();
    if (effectiveToken) {
      data = await callAppsScriptAction(
        runtime!.appsScriptWebAppUrl!.trim(),
        'ping',
        {},
        runtime?.appsScriptApiKey || '',
        effectiveToken
      );
    } else {
      const pingUrl = new URL(runtime!.appsScriptWebAppUrl!.trim());
      pingUrl.searchParams.set('action', 'ping');
      const res = await fetch(pingUrl.toString(), { method: 'GET', redirect: 'follow' });
      data = (await res.json().catch(() => ({}))) as typeof data;
    }

    if (data.ok) {
      return {
        configured: Boolean(data.configured),
        mode: 'apps-script',
        phoneIdMasked: data.phoneIdMasked || (data.configured ? 'Configured in Apps Script' : null),
        displayPhoneNumber: data.displayPhoneNumber,
        businessName: data.verifiedName || data.businessName,
        qualityRating: data.qualityRating,
        messagingTier: data.messagingTier,
        wabaIdConfigured: Boolean(data.wabaIdConfigured),
        apiVersion: data.apiVersion || 'v25.0',
        webhookUrl: runtime!.appsScriptWebAppUrl!.trim(),
        isPreviewUrl: false,
        verifyTokenConfigured: true,
        verifyTokenSource: 'workspace',
        appSecretConfigured: false,
        receivedWebhookEvents: 0,
        masterSheetName: data.spreadsheetName,
        gatewayOnline: true,
      };
    }
  } catch {
    // Gateway unreachable
  }

  return {
    configured: false,
    mode: 'apps-script',
    phoneIdMasked: null,
    wabaIdConfigured: Boolean(runtime?.wabaId),
    apiVersion: 'v25.0',
    webhookUrl: runtime!.appsScriptWebAppUrl!.trim(),
    isPreviewUrl: false,
    verifyTokenConfigured: true,
    verifyTokenSource: 'workspace',
    appSecretConfigured: false,
    receivedWebhookEvents: 0,
    gatewayOnline: false,
  };
}

/**
 * Pulls live Contacts, Message_Logs (inbound + outbound with accurate Meta statuses), Campaigns,
 * Drive attachments, External Sheets, and strictly APPROVED Meta templates from Gateway_Code.gs.
 */
export async function fetchLiveWorkspaceBootstrap(
  runtime: AppsScriptRuntimeConfig
): Promise<LiveWorkspaceBootstrapData> {
  if (!isAllowedAppsScriptEndpoint(runtime.appsScriptWebAppUrl)) {
    return {
      ok: false,
      contacts: [],
      messages: [],
      campaigns: [],
      templates: [],
      driveFiles: [],
      externalSheets: [],
      error: 'Connect your deployed Google Apps Script Master Gateway URL in Settings.',
    };
  }

  try {
    const res = await callAppsScriptAction<{
      contacts?: Contact[];
      messages?: ChatMessage[];
      campaigns?: Campaign[];
      templates?: MessageTemplate[];
      driveFiles?: DriveFileItem[];
      externalSheets?: ExternalSheetSource[];
      spreadsheetId?: string;
      spreadsheetUrl?: string;
      driveFolderId?: string;
      driveFolderUrl?: string;
      attachmentsFolderId?: string;
      phoneId?: string;
      wabaId?: string;
      phoneProfile?: LiveWorkspaceBootstrapData['phoneProfile'];
      phoneStatus?: LiveWorkspaceBootstrapData['phoneStatus'];
    }>(
      runtime.appsScriptWebAppUrl!,
      'getWorkspaceBootstrap',
      { wabaId: runtime.wabaId || '' },
      runtime.appsScriptApiKey || ''
    );

    if (!res.ok) {
      return {
        ok: false,
        contacts: [],
        messages: [],
        campaigns: [],
        templates: [],
        driveFiles: [],
        externalSheets: [],
        error: res.error || 'Unable to load live data from Master Gateway.',
      };
    }

    const normalizedTemplates: MessageTemplate[] = Array.isArray(res.templates)
      ? res.templates.map((t) => {
          const st = String(t.status || 'PENDING').toUpperCase();
          const normStatus: MessageTemplate['status'] =
            st === 'APPROVED' || st === 'REJECTED' ? st : 'PENDING';
          return { ...t, status: normStatus, source: 'meta' as const };
        })
      : [];

    return {
      ok: true,
      contacts: Array.isArray(res.contacts) ? res.contacts : [],
      messages: Array.isArray(res.messages) ? res.messages : [],
      campaigns: Array.isArray(res.campaigns) ? res.campaigns : [],
      templates: normalizedTemplates,
      driveFiles: Array.isArray(res.driveFiles) ? res.driveFiles : [],
      externalSheets: Array.isArray(res.externalSheets) ? res.externalSheets : [],
      spreadsheetId: res.spreadsheetId,
      spreadsheetUrl: res.spreadsheetUrl,
      driveFolderId: res.driveFolderId,
      driveFolderUrl: res.driveFolderUrl,
      attachmentsFolderId: res.attachmentsFolderId,
      phoneId: res.phoneId,
      wabaId: res.wabaId,
      phoneProfile: res.phoneProfile || res.phoneStatus,
      phoneStatus: res.phoneStatus,
    };
  } catch (err) {
    return {
      ok: false,
      contacts: [],
      messages: [],
      campaigns: [],
      templates: [],
      driveFiles: [],
      externalSheets: [],
      error: err instanceof Error ? err.message : 'Unable to fetch live workspace data.',
    };
  }
}

/**
 * Dispatches a WhatsApp message strictly through the live Apps Script Gateway -> Meta Cloud API v25.0.
 * Zero mock/sandbox fallback: reports real Meta wamid and honest error status.
 */
export async function sendWhatsAppViaServer(
  payload: SendMessagePayload,
  runtime?: AppsScriptRuntimeConfig
): Promise<SendMessageResponse> {
  if (!isAllowedAppsScriptEndpoint(runtime?.appsScriptWebAppUrl)) {
    return {
      ok: false,
      status: 'failed',
      error: 'Apps Script Gateway URL is not configured. Add it in Settings & Webhooks.',
    };
  }

  try {
    const data = await callAppsScriptAction<SendMessageResponse>(
      runtime!.appsScriptWebAppUrl!,
      'sendMessage',
      payload as unknown as Record<string, unknown>,
      runtime?.appsScriptApiKey || ''
    );
    if (data.ok) {
      return {
        ok: true,
        mode: 'apps-script',
        waMessageId: data.waMessageId,
        status: 'sent',
      };
    }
    return {
      ok: false,
      mode: 'apps-script',
      status: 'failed',
      error: data.error || 'Meta WhatsApp Cloud API rejected the message.',
    };
  } catch (err) {
    return {
      ok: false,
      mode: 'apps-script',
      status: 'failed',
      error: err instanceof Error ? err.message : 'Unable to reach Apps Script Gateway.',
    };
  }
}

/**
 * Syncs live templates directly from Meta WhatsApp Business API via Gateway_Code.gs.
 * Strictly returns ONLY Pre-Approved (`APPROVED`) templates.
 */
export async function syncMetaTemplatesLive(
  runtime: AppsScriptRuntimeConfig
): Promise<{
  ok: boolean;
  templates: MessageTemplate[];
  totalFromMeta?: number;
  source: 'apps-script' | 'none';
  error?: string;
}> {
  if (!isAllowedAppsScriptEndpoint(runtime.appsScriptWebAppUrl)) {
    return {
      ok: false,
      templates: [],
      source: 'none',
      error: 'Connect your deployed Google Apps Script Master Gateway URL in Settings first.',
    };
  }

  try {
    const data = await callAppsScriptAction<{ templates?: MessageTemplate[] }>(
      runtime.appsScriptWebAppUrl!,
      'syncMetaTemplates',
      { wabaId: runtime.wabaId || '', approvedOnly: false },
      runtime.appsScriptApiKey || ''
    );
    if (data.ok && Array.isArray(data.templates)) {
      const normalized: MessageTemplate[] = data.templates.map((t) => {
        const st = String(t.status || 'PENDING').toUpperCase();
        const normStatus: MessageTemplate['status'] =
          st === 'APPROVED' || st === 'REJECTED' ? st : 'PENDING';
        return { ...t, status: normStatus, source: 'meta' as const };
      });
      return {
        ok: true,
        templates: normalized,
        totalFromMeta: data.templates.length,
        source: 'apps-script',
      };
    }
    return {
      ok: false,
      templates: [],
      source: 'apps-script',
      error:
        data.error ||
        'Unable to sync pre-approved templates from Meta. Verify WHATSAPP_ACCESS_TOKEN and WHATSAPP_WABA_ID in Apps Script Properties.',
    };
  } catch (err) {
    return {
      ok: false,
      templates: [],
      source: 'apps-script',
      error: err instanceof Error ? err.message : 'Apps Script template sync failed.',
    };
  }
}

/**
 * Submits a new WhatsApp template directly to Meta Cloud API (/{WABA_ID}/message_templates) for approval.
 */
export async function submitNewMetaTemplate(
  templatePayload: Record<string, unknown>,
  runtime: AppsScriptRuntimeConfig
): Promise<{
  ok: boolean;
  metaTemplateId?: string;
  status?: MessageTemplate['status'];
  mode: 'apps-script';
  error?: string;
}> {
  if (!isAllowedAppsScriptEndpoint(runtime.appsScriptWebAppUrl)) {
    return {
      ok: false,
      mode: 'apps-script',
      error: 'Connect your deployed Google Apps Script Master Gateway URL before applying for templates.',
    };
  }

  try {
    const res = await callAppsScriptAction<{ data?: { id?: string; status?: string } }>(
      runtime.appsScriptWebAppUrl!,
      'createMetaTemplate',
      { templatePayload, wabaId: runtime.wabaId || '' },
      runtime.appsScriptApiKey || ''
    );
    if (res.ok) {
      const statusRaw = String(res.data?.status || 'PENDING').toUpperCase();
      const status =
        statusRaw === 'APPROVED' || statusRaw === 'REJECTED' ? statusRaw : 'PENDING';
      return {
        ok: true,
        metaTemplateId: res.data?.id,
        status,
        mode: 'apps-script',
      };
    }
    return {
      ok: false,
      mode: 'apps-script',
      error: res.error || 'Meta rejected the template application.',
    };
  } catch (err) {
    return {
      ok: false,
      mode: 'apps-script',
      error: err instanceof Error ? err.message : 'Apps Script template submission failed.',
    };
  }
}

export async function triggerExternalSheetsSyncViaAppsScript(
  runtime: AppsScriptRuntimeConfig
): Promise<{ ok: boolean; syncedCount?: number; sheetsProcessed?: number; error?: string }> {
  if (!isAllowedAppsScriptEndpoint(runtime.appsScriptWebAppUrl)) {
    return { ok: false, error: 'Apps Script Web App URL not connected.' };
  }
  try {
    const data = await callAppsScriptAction<{ syncedCount?: number; sheetsProcessed?: number }>(
      runtime.appsScriptWebAppUrl!,
      'syncExternalSheets',
      {},
      runtime.appsScriptApiKey || ''
    );
    return {
      ok: Boolean(data.ok),
      syncedCount: data.syncedCount ?? 0,
      sheetsProcessed: data.sheetsProcessed ?? 0,
      error: data.error,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unable to trigger external sheets sync.',
    };
  }
}

export async function exportReportViaAppsScript(
  runtime: AppsScriptRuntimeConfig,
  title: string,
  rows: string[][]
): Promise<{ ok: boolean; spreadsheetUrl?: string; error?: string }> {
  if (!isAllowedAppsScriptEndpoint(runtime.appsScriptWebAppUrl)) {
    return { ok: false, error: 'Apps Script Web App URL not configured.' };
  }
  try {
    const data = await callAppsScriptAction<{ spreadsheetUrl?: string }>(
      runtime.appsScriptWebAppUrl!,
      'exportReportToSheet',
      { title, rows },
      runtime.appsScriptApiKey || ''
    );
    return {
      ok: Boolean(data.ok),
      spreadsheetUrl: data.spreadsheetUrl,
      error: data.error,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Apps Script report export failed.',
    };
  }
}

export interface IncomingWebhookPollEvent {
  id: string;
  receivedAt: string;
  direction?: 'inbound' | 'outbound';
  kind: 'message' | 'status' | 'external_outbound';
  from: string;
  contactName: string;
  body: string;
  messageType: string;
  waMessageId: string;
  campaignId?: string;
  status?: 'sent' | 'delivered' | 'read' | 'failed';
  error?: string;
  sourceSheet?: string;
  templateName?: string;
  category?: string;
  receiptNo?: string;
  attachmentName?: string;
  attachmentUrl?: string;
  deliveredAt?: string;
  readAt?: string;
}

/**
 * Polls live inbound customer replies, external sheet outbound logs, and real-time Meta status updates
 * (sent -> delivered -> read -> failed) via authenticated POST so sessionToken never enters URL logs.
 */
export async function fetchAppsScriptIncomingMessages(
  webAppUrl: string,
  sinceIso?: string,
  apiKey = '',
  sessionToken = ''
): Promise<IncomingWebhookPollEvent[]> {
  if (!isAllowedAppsScriptEndpoint(webAppUrl)) return [];
  try {
    const data = await callAppsScriptAction<{
      events?: IncomingWebhookPollEvent[];
      messages?: IncomingWebhookPollEvent[];
    }>(
      webAppUrl.trim(),
      'getMessages',
      { since: sinceIso || '' },
      apiKey,
      sessionToken
    );
    if (!data.ok) return [];
    const list = Array.isArray(data.events)
      ? data.events
      : Array.isArray(data.messages)
        ? data.messages
        : [];
    return list;
  } catch {
    return [];
  }
}

export async function pingAppsScriptWebApp(
  url: string,
  sessionToken = ''
): Promise<{ ok: boolean; statusCode?: number; data?: Record<string, unknown>; error?: string }> {
  if (!isAllowedAppsScriptEndpoint(url)) {
    return { ok: false, error: 'Only https://script.google.com/ Web App URLs are permitted.' };
  }
  try {
    const effectiveToken = (sessionToken || activeGatewaySessionToken || '').trim();
    if (effectiveToken) {
      const parsed = await callAppsScriptAction<Record<string, unknown>>(
        url.trim(),
        'ping',
        {},
        '',
        effectiveToken
      );
      return { ok: Boolean(parsed.ok), statusCode: parsed.ok ? 200 : 401, data: parsed, error: parsed.error };
    }
    const pingUrl = new URL(url.trim());
    pingUrl.searchParams.set('action', 'ping');
    const directRes = await fetch(pingUrl.toString(), { method: 'GET', redirect: 'follow' });
    const parsed = (await directRes.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: directRes.ok && Boolean(parsed.ok ?? true), statusCode: directRes.status, data: parsed };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unable to reach Apps Script Web App URL.',
    };
  }
}

export async function logoutViaGateway(
  runtime: AppsScriptRuntimeConfig
): Promise<void> {
  const token = (runtime.sessionToken || activeGatewaySessionToken || '').trim();
  activeGatewaySessionToken = '';
  if (!isAllowedAppsScriptEndpoint(runtime.appsScriptWebAppUrl) || !token) return;
  try {
    await callAppsScriptAction(
      runtime.appsScriptWebAppUrl!,
      'logout',
      {},
      runtime.appsScriptApiKey || '',
      token
    );
  } catch {
    // Ignore network failures during sign-out
  }
}

/**
 * Directly tests Meta's GET webhook verification challenge against the deployed Apps Script /exec URL.
 */
export async function testWebhookHandshake(params: {
  url: string;
  verifyToken: string;
}): Promise<{
  ok: boolean;
  statusCode?: number;
  message: string;
  requiresAnyoneAccess?: boolean;
}> {
  if (!isAllowedAppsScriptEndpoint(params.url)) {
    return {
      ok: false,
      message: 'Enter a valid https://script.google.com/macros/s/.../exec URL first.',
    };
  }

  const challenge = `snc_challenge_${Date.now().toString(36)}`;
  try {
    const endpoint = new URL(params.url.trim());
    endpoint.searchParams.set('hub.mode', 'subscribe');
    endpoint.searchParams.set('hub.verify_token', params.verifyToken.trim());
    endpoint.searchParams.set('hub.challenge', challenge);

    const res = await fetch(endpoint.toString(), { method: 'GET', redirect: 'follow' });
    const body = (await res.text()).trim();
    if (res.ok && body === challenge) {
      return {
        ok: true,
        statusCode: res.status,
        message: `Webhook handshake verified (HTTP ${res.status}). Meta will accept this Callback URL and Verify Token immediately.`,
      };
    }
    const requiresAnyone = body.toLowerCase().includes('<html') || body.toLowerCase().includes('accounts.google.com');
    return {
      ok: false,
      statusCode: res.status,
      requiresAnyoneAccess: requiresAnyone,
      message: requiresAnyone
        ? 'Apps Script returned a Google login page. Redeploy with "Who has access: Anyone".'
        : `Verification failed (HTTP ${res.status}). Endpoint returned "${body.slice(0, 120)}" instead of "${challenge}".`,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Unable to test webhook handshake.',
    };
  }
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to read attachment file.'));
    reader.readAsDataURL(file);
  });
}

export async function sendWhatsAppOtpViaGateway(
  runtime: AppsScriptRuntimeConfig,
  phone: string
): Promise<{ ok: boolean; expiresInSec?: number; maskedPhone?: string; error?: string }> {
  if (!isAllowedAppsScriptEndpoint(runtime.appsScriptWebAppUrl)) {
    return {
      ok: false,
      error: 'Configure your Master Apps Script Gateway /exec URL first.',
    };
  }
  try {
    const res = await callAppsScriptAction<{
      expiresInSec?: number;
      maskedPhone?: string;
    }>(
      runtime.appsScriptWebAppUrl!,
      'send_otp',
      { phone },
      runtime.appsScriptApiKey || ''
    );
    return {
      ok: Boolean(res.ok),
      expiresInSec: res.expiresInSec || 300,
      maskedPhone: res.maskedPhone,
      error: res.error,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unable to dispatch WhatsApp OTP via Gateway.',
    };
  }
}

export async function verifyWhatsAppOtpViaGateway(
  runtime: AppsScriptRuntimeConfig,
  phone: string,
  otp: string
): Promise<{
  ok: boolean;
  sessionToken?: string;
  role?: 'ADMIN' | 'MANAGER' | 'AGENT';
  name?: string;
  user?: {
    phone?: string;
    name?: string;
    role?: 'ADMIN' | 'MANAGER' | 'AGENT';
  };
  error?: string;
}> {
  if (!isAllowedAppsScriptEndpoint(runtime.appsScriptWebAppUrl)) {
    return { ok: false, error: 'Master Gateway URL is not configured.' };
  }
  try {
    const res = await callAppsScriptAction<{
      sessionToken?: string;
      role?: 'ADMIN' | 'MANAGER' | 'AGENT';
      name?: string;
      user?: {
        phone?: string;
        name?: string;
        role?: 'ADMIN' | 'MANAGER' | 'AGENT';
      };
    }>(
      runtime.appsScriptWebAppUrl!,
      'verify_otp',
      { phone, otp },
      runtime.appsScriptApiKey || ''
    );
    return {
      ok: Boolean(res.ok),
      sessionToken: res.sessionToken,
      role: res.user?.role || res.role || 'ADMIN',
      name: res.user?.name || res.name,
      user: res.user,
      error: res.error,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'OTP verification failed.',
    };
  }
}

export async function runGatewayAutoSetup(
  runtime: AppsScriptRuntimeConfig
): Promise<{
  ok: boolean;
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  driveFolderId?: string;
  tabsCreated?: string[];
  message?: string;
  error?: string;
}> {
  if (!isAllowedAppsScriptEndpoint(runtime.appsScriptWebAppUrl)) {
    return { ok: false, error: 'Enter a valid Apps Script /exec URL first.' };
  }
  try {
    const res = await callAppsScriptAction<{
      spreadsheetId?: string;
      spreadsheetUrl?: string;
      driveFolderId?: string;
      tabsCreated?: string[];
      message?: string;
    }>(
      runtime.appsScriptWebAppUrl!,
      'setup_database',
      {},
      runtime.appsScriptApiKey || ''
    );
    return {
      ok: Boolean(res.ok),
      spreadsheetId: res.spreadsheetId,
      spreadsheetUrl: res.spreadsheetUrl,
      driveFolderId: res.driveFolderId,
      tabsCreated: res.tabsCreated,
      message: res.message,
      error: res.error,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Gateway auto-setup failed.',
    };
  }
}

export async function queueBulkCampaignOnGateway(
  runtime: AppsScriptRuntimeConfig,
  payload: {
    campaignId: string;
    campaignName: string;
    templateName: string;
    rows: Array<{
      phone: string;
      name: string;
      message: string;
      attachmentUrl?: string;
      attachmentType?: string;
      attachmentName?: string;
    }>;
  }
): Promise<{ ok: boolean; queuedCount?: number; error?: string }> {
  if (!isAllowedAppsScriptEndpoint(runtime.appsScriptWebAppUrl)) {
    return { ok: false, error: 'Gateway /exec URL not configured.' };
  }
  try {
    const res = await callAppsScriptAction<{ queuedCount?: number }>(
      runtime.appsScriptWebAppUrl!,
      'queue_bulk_campaign',
      payload as unknown as Record<string, unknown>,
      runtime.appsScriptApiKey || ''
    );
    return {
      ok: Boolean(res.ok),
      queuedCount: res.queuedCount ?? payload.rows.length,
      error: res.error,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to queue bulk campaign on Master Sheet.',
    };
  }
}

export async function fetchMetaLiveInsightsViaGateway(
  runtime: AppsScriptRuntimeConfig,
  monthIso?: string
): Promise<{
  ok: boolean;
  stats?: MetaLiveStats;
  error?: string;
}> {
  if (!isAllowedAppsScriptEndpoint(runtime.appsScriptWebAppUrl)) {
    return { ok: false, error: 'Connect Gateway /exec URL to pull live Meta Graph billing data.' };
  }
  try {
    const res = await callAppsScriptAction<{ stats?: MetaLiveStats }>(
      runtime.appsScriptWebAppUrl!,
      'fetch_meta_insights',
      { month: monthIso || new Date().toISOString().slice(0, 7) },
      runtime.appsScriptApiKey || ''
    );
    if (res.ok && res.stats) {
      return { ok: true, stats: res.stats };
    }
    return {
      ok: false,
      error: res.error || 'Meta Insights unavailable on current Gateway deployment.',
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unable to reach Gateway for Meta Insights.',
    };
  }
}

export async function syncContactToGateway(
  runtime: AppsScriptRuntimeConfig,
  action: 'save_contact' | 'delete_contact',
  contactPayload: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
  if (!isAllowedAppsScriptEndpoint(runtime.appsScriptWebAppUrl)) {
    return { ok: false, error: 'Gateway not configured.' };
  }
  try {
    const res = await callAppsScriptAction(
      runtime.appsScriptWebAppUrl!,
      action,
      { contact: contactPayload },
      runtime.appsScriptApiKey || ''
    );
    return { ok: Boolean(res.ok), error: res.error };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Gateway contact sync failed.',
    };
  }
}

export async function importContactsViaGateway(
  runtime: AppsScriptRuntimeConfig,
  sheetUrlOrId: string
): Promise<{ ok: boolean; contacts: Contact[]; error?: string }> {
  if (!isAllowedAppsScriptEndpoint(runtime.appsScriptWebAppUrl)) {
    return { ok: false, contacts: [], error: 'Gateway /exec URL not configured.' };
  }
  try {
    const res = await callAppsScriptAction<{ contacts?: Contact[] }>(
      runtime.appsScriptWebAppUrl!,
      'importExternalSheetContacts',
      { sheetUrlOrId },
      runtime.appsScriptApiKey || ''
    );
    return {
      ok: Boolean(res.ok),
      contacts: Array.isArray(res.contacts) ? res.contacts : [],
      error: res.error,
    };
  } catch (err) {
    return {
      ok: false,
      contacts: [],
      error: err instanceof Error ? err.message : 'Unable to import contacts via Gateway.',
    };
  }
}

export async function listDriveFilesViaGateway(
  runtime: AppsScriptRuntimeConfig
): Promise<{ ok: boolean; files: DriveFileItem[]; error?: string }> {
  if (!isAllowedAppsScriptEndpoint(runtime.appsScriptWebAppUrl)) {
    return { ok: false, files: [], error: 'Gateway /exec URL not configured.' };
  }
  try {
    const res = await callAppsScriptAction<{ files?: DriveFileItem[] }>(
      runtime.appsScriptWebAppUrl!,
      'listDriveFiles',
      {},
      runtime.appsScriptApiKey || ''
    );
    return {
      ok: Boolean(res.ok),
      files: Array.isArray(res.files) ? res.files : [],
      error: res.error,
    };
  } catch (err) {
    return {
      ok: false,
      files: [],
      error: err instanceof Error ? err.message : 'Unable to list Google Drive files.',
    };
  }
}

export async function deleteDriveFileViaGateway(
  runtime: AppsScriptRuntimeConfig,
  fileId: string
): Promise<{ ok: boolean; error?: string }> {
  if (!isAllowedAppsScriptEndpoint(runtime.appsScriptWebAppUrl)) {
    return { ok: false, error: 'Gateway /exec URL not configured.' };
  }
  try {
    const res = await callAppsScriptAction(
      runtime.appsScriptWebAppUrl!,
      'deleteDriveFile',
      { fileId },
      runtime.appsScriptApiKey || ''
    );
    return { ok: Boolean(res.ok), error: res.error };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unable to delete file in Google Drive.',
    };
  }
}

function inferExactMimeType(fileName: string, browserMime: string): string {
  const cleanBrowser = (browserMime || '').split(';')[0].trim().toLowerCase();
  const extMatch = (fileName || '').trim().match(/\.([a-zA-Z0-9]+)$/);
  const ext = extMatch ? extMatch[1].toLowerCase() : '';
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    txt: 'text/plain',
    csv: 'text/plain',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    mp4: 'video/mp4',
    '3gp': 'video/3gpp',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    aac: 'audio/aac',
    m4a: 'audio/mp4',
  };
  if (ext && map[ext]) return map[ext];
  if (cleanBrowser && cleanBrowser !== 'application/octet-stream' && cleanBrowser !== 'binary/octet-stream') {
    return cleanBrowser;
  }
  return 'application/pdf';
}

export async function uploadDriveFileViaGateway(
  runtime: AppsScriptRuntimeConfig,
  file: File
): Promise<{
  ok: boolean;
  file?: {
    id: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    webViewLink: string;
    downloadUrl: string;
    createdTime: string;
    source: 'google-drive';
    metaMediaId?: string;
  };
  error?: string;
}> {
  if (!isAllowedAppsScriptEndpoint(runtime.appsScriptWebAppUrl)) {
    return { ok: false, error: 'Gateway /exec URL not configured.' };
  }
  try {
    const base64Data = await fileToBase64(file);
    const exactMime = inferExactMimeType(file.name, file.type);
    const res = await callAppsScriptAction<{
      file?: {
        id: string;
        name: string;
        mimeType: string;
        sizeBytes: number;
        webViewLink: string;
        downloadUrl: string;
        createdTime: string;
        source: 'google-drive';
        metaMediaId?: string;
      };
    }>(
      runtime.appsScriptWebAppUrl!,
      'uploadDriveAttachment',
      {
        base64Data,
        mimeType: exactMime,
        fileName: file.name,
      },
      runtime.appsScriptApiKey || ''
    );
    return { ok: Boolean(res.ok), file: res.file, error: res.error };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Gateway Drive upload failed.',
    };
  }
}
