import type {
  Attachment,
  AttachmentKind,
  Campaign,
  ChatMessage,
  Contact,
  ExternalSheetSource,
  MessageTemplate,
  WorkspaceConfig,
} from '../types';

export const CONTACTS_SHEET_HEADERS = [
  'id',
  'name',
  'phone',
  'email',
  'company',
  'tags',
  'status',
  'assigned_agent',
  'custom1',
  'custom2',
  'attachment_url',
  'attachment_name',
  'notes',
  'last_message_at',
] as const;

export const MESSAGE_LOGS_SHEET_HEADERS = [
  'message_id',
  'timestamp',
  'direction',
  'phone',
  'contact_name',
  'type',
  'body',
  'attachment_name',
  'attachment_url',
  'status',
  'campaign_id',
  'wa_message_id',
  'source_sheet',
  'template_name',
  'category',
  'delivered_at',
  'read_at',
  'replied_at',
  'billable',
  'estimated_cost',
  'receipt_no',
  'error_message',
] as const;

export const CONNECTED_SHEETS_HEADERS = [
  'sheet_link_id',
  'label',
  'spreadsheet_id',
  'tab_name',
  'default_template',
  'default_category',
  'col_phone',
  'col_name',
  'col_message',
  'col_wa_id',
  'col_status',
  'col_timestamp',
  'col_attachment_url',
  'col_receipt_no',
  'last_synced_row',
  'last_synced_at',
  'enabled',
] as const;

export const CAMPAIGNS_SHEET_HEADERS = [
  'campaign_id',
  'name',
  'created_at',
  'total_recipients',
  'sent',
  'delivered',
  'failed',
  'template_name',
  'attachment_mode',
  'attachment_url',
  'status',
] as const;

export const TEMPLATES_SHEET_HEADERS = [
  'template_id',
  'name',
  'category',
  'language',
  'header_type',
  'header_text',
  'body',
  'footer',
  'variables',
  'status',
  'updated_at',
] as const;

export const CONFIG_SHEET_HEADERS = [
  'key',
  'value',
  'description',
  'updated_at',
] as const;

/**
 * Strips non-digits and prepends default country code when a local 10-digit number is supplied.
 */
export function normalizePhone(raw: string, defaultCountryCode = '91'): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  const hasPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';

  // Remove leading international '00' prefix
  if (!hasPlus && digits.startsWith('00')) {
    digits = digits.slice(2);
  }
  // Remove leading local trunk '0' on 11-digit numbers (e.g. 09876543210)
  if (!hasPlus && digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  // Prepend default country code for 10-digit local numbers
  const cleanCc = defaultCountryCode.replace(/\D/g, '');
  if (!hasPlus && digits.length === 10 && cleanCc) {
    digits = `${cleanCc}${digits}`;
  }
  return digits;
}

/**
 * Validates E.164 digit length (7 to 15 digits, cannot start with 0).
 */
export function isValidPhone(normalizedDigits: string): boolean {
  return /^[1-9]\d{6,14}$/.test(normalizedDigits);
}

/**
 * Formats normalized digits into a readable international phone display string.
 */
export function formatPhoneDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return `+${digits}`;
}

/**
 * Checks whether a URL is a safe https:// URL (blocks javascript:, data:, file:, etc.).
 */
export function isSafeHttpsUrl(rawUrl: string): boolean {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Infers attachment kind from MIME type or file extension.
 */
export function inferAttachmentKind(mimeType: string, fileName = ''): AttachmentKind {
  const lowerMime = (mimeType || '').toLowerCase();
  const lowerName = (fileName || '').toLowerCase();
  if (lowerMime.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/.test(lowerName)) {
    return 'image';
  }
  if (lowerMime.startsWith('video/') || /\.(mp4|mov|webm|3gp)$/.test(lowerName)) {
    return 'video';
  }
  if (lowerMime.startsWith('audio/') || /\.(mp3|ogg|wav|m4a|aac)$/.test(lowerName)) {
    return 'audio';
  }
  return 'document';
}

/**
 * Formats byte sizes cleanly for attachment cards.
 */
export function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Extracts unique merge variable tokens like {{name}} or {{1}} from a template string.
 */
export function extractTemplateVariables(template: string): string[] {
  const matches = template.match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g) || [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of matches) {
    const token = raw.replace(/^\{\{\s*|\s*\}\}$/g, '');
    if (!seen.has(token)) {
      seen.add(token);
      result.push(token);
    }
  }
  return result;
}

/**
 * Interpolates named and positional placeholders for a contact.
 * Named: {{name}}, {{first_name}}, {{phone}}, {{email}}, {{company}}, {{custom1}}, {{custom2}}
 * Positional: {{1}} -> name, {{2}} -> company || custom1, {{3}} -> custom2
 */
export function renderMessageTemplate(
  template: string,
  contact: Partial<Contact>,
  extraVars: Record<string, string> = {}
): string {
  const fullName = (contact.name || '').trim() || 'Customer';
  const firstName = fullName.split(/\s+/)[0] || 'Customer';
  const values: Record<string, string> = {
    name: fullName,
    first_name: firstName,
    phone: contact.phone ? formatPhoneDisplay(contact.phone) : '',
    email: contact.email || '',
    company: contact.company || '',
    custom1: contact.custom1 || '',
    custom2: contact.custom2 || '',
    '1': fullName,
    '2': contact.custom1 || contact.company || '',
    '3': contact.custom2 || '',
    ...extraVars,
  };

  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const normalizedKey = key.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(extraVars, key) && extraVars[key]) {
      return extraVars[key];
    }
    if (Object.prototype.hasOwnProperty.call(values, normalizedKey) && values[normalizedKey]) {
      return values[normalizedKey];
    }
    return '';
  });
}

/**
 * Resolves the attachment to send to a recipient in a bulk broadcast.
 */
export function resolveRecipientAttachment(
  mode: 'none' | 'shared' | 'per-contact',
  sharedAttachment: Attachment | null,
  contact: Contact
): Attachment | null {
  if (mode === 'none') return null;
  if (mode === 'shared') return sharedAttachment;

  const url = (contact.attachmentUrl || '').trim();
  if (!url) return sharedAttachment; // Fallback to shared if provided
  const name =
    (contact.attachmentName || '').trim() ||
    url.split('/').pop()?.split('?')[0] ||
    `${contact.name.replace(/\s+/g, '_')}_attachment.pdf`;
  const kind = inferAttachmentKind('', name);
  return {
    id: `att-${contact.id}`,
    kind,
    name,
    mimeType:
      kind === 'image'
        ? 'image/jpeg'
        : kind === 'video'
          ? 'video/mp4'
          : 'application/pdf',
    url,
  };
}

/**
 * Parses a single CSV line respecting quoted commas and escaped quotes.
 */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

export interface CsvImportResult {
  contacts: Contact[];
  skippedRows: number;
}

/**
 * Parses CSV text into Contact records with E.164 normalization and deduplication.
 */
export function parseCsvContacts(
  csvText: string,
  defaultCountryCode = '91',
  nowIso = new Date().toISOString()
): CsvImportResult {
  const lines = csvText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return { contacts: [], skippedRows: 0 };
  }

  const headers = parseCsvLine(lines[0]).map((h) =>
    h.toLowerCase().replace(/[^a-z0-9]/g, '')
  );

  const findIndex = (candidates: string[]) =>
    headers.findIndex((h) => candidates.includes(h));

  const nameIdx = findIndex(['name', 'fullname', 'contactname', 'customer']);
  const phoneIdx = findIndex(['phone', 'whatsapp', 'mobile', 'phonenumber', 'number']);
  const emailIdx = findIndex(['email', 'emailaddress']);
  const companyIdx = findIndex(['company', 'organization', 'business']);
  const tagsIdx = findIndex(['tags', 'tag', 'segment', 'group']);
  const custom1Idx = findIndex(['custom1', 'orderid', 'plan', 'var1', 'field1']);
  const custom2Idx = findIndex(['custom2', 'city', 'amount', 'var2', 'field2']);
  const attUrlIdx = findIndex(['attachmenturl', 'attachment', 'fileurl', 'pdfurl', 'mediaurl']);
  const attNameIdx = findIndex(['attachmentname', 'filename']);
  const notesIdx = findIndex(['notes', 'note', 'remarks']);

  if (phoneIdx === -1) {
    return { contacts: [], skippedRows: lines.length - 1 };
  }

  const seenPhones = new Set<string>();
  const contacts: Contact[] = [];
  let skippedRows = 0;

  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]);
    const phone = normalizePhone(row[phoneIdx] || '', defaultCountryCode);
    if (!isValidPhone(phone) || seenPhones.has(phone)) {
      skippedRows++;
      continue;
    }
    seenPhones.add(phone);

    const rawTags = tagsIdx >= 0 ? row[tagsIdx] || '' : '';
    const tags = rawTags
      .split(/[;|]/)
      .map((t) => t.trim())
      .filter(Boolean);

    const rawAttUrl = attUrlIdx >= 0 ? (row[attUrlIdx] || '').trim() : '';
    const safeAttUrl = isSafeHttpsUrl(rawAttUrl) ? rawAttUrl : '';

    contacts.push({
      id: `cnt-${phone}-${i}`,
      name: (nameIdx >= 0 ? row[nameIdx] : '') || `Contact ${phone.slice(-4)}`,
      phone,
      email: emailIdx >= 0 ? row[emailIdx] || '' : '',
      company: companyIdx >= 0 ? row[companyIdx] || '' : '',
      tags: tags.length > 0 ? tags : ['Imported'],
      status: 'open',
      assignedAgent: 'Sanket Rathod',
      custom1: custom1Idx >= 0 ? row[custom1Idx] || '' : '',
      custom2: custom2Idx >= 0 ? row[custom2Idx] || '' : '',
      attachmentUrl: safeAttUrl,
      attachmentName: attNameIdx >= 0 ? row[attNameIdx] || '' : '',
      notes: notesIdx >= 0 ? row[notesIdx] || '' : '',
      unreadCount: 0,
      lastMessagePreview: 'Imported from CSV / Sheet',
      lastMessageAt: nowIso,
    });
  }

  return { contacts, skippedRows };
}

/**
 * Builds deduplicated, validated bulk broadcast recipients from selected contacts + manual numbers.
 */
export function buildBulkRecipients(
  selectedContacts: Contact[],
  manualNumbersRaw: string,
  defaultCountryCode = '91'
): { valid: Contact[]; invalidEntries: string[] } {
  const seen = new Set<string>();
  const valid: Contact[] = [];
  const invalidEntries: string[] = [];

  for (const contact of selectedContacts) {
    const normalized = normalizePhone(contact.phone, defaultCountryCode);
    if (!isValidPhone(normalized)) {
      invalidEntries.push(contact.phone || contact.name);
      continue;
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      valid.push({ ...contact, phone: normalized });
    }
  }

  const manualLines = (manualNumbersRaw || '')
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const entry of manualLines) {
    const normalized = normalizePhone(entry, defaultCountryCode);
    if (!isValidPhone(normalized)) {
      invalidEntries.push(entry);
      continue;
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      valid.push({
        id: `manual-${normalized}`,
        name: `Recipient ${normalized.slice(-4)}`,
        phone: normalized,
        email: '',
        company: '',
        tags: ['Ad-hoc'],
        status: 'open',
        assignedAgent: 'Sanket Rathod',
        custom1: '',
        custom2: '',
        attachmentUrl: '',
        attachmentName: '',
        notes: '',
        unreadCount: 0,
        lastMessagePreview: '',
        lastMessageAt: new Date().toISOString(),
      });
    }
  }

  return { valid, invalidEntries };
}

/**
 * Serializers and deserializers for Google Sheets storage.
 */
export function contactsToSheetRows(contacts: Contact[]): string[][] {
  return [
    [...CONTACTS_SHEET_HEADERS],
    ...contacts.map((c) => [
      c.id,
      c.name,
      c.phone,
      c.email,
      c.company,
      c.tags.join('; '),
      c.status,
      c.assignedAgent,
      c.custom1,
      c.custom2,
      c.attachmentUrl,
      c.attachmentName,
      c.notes,
      c.lastMessageAt,
    ]),
  ];
}

export function sheetRowsToContacts(
  rows: string[][],
  defaultCountryCode = '91'
): Contact[] {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0].map((h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
  const idx = (candidates: string[]) => headers.findIndex((h) => candidates.includes(h));

  const idI = idx(['id']);
  const nameI = idx(['name', 'fullname', 'contactname', 'customer']);
  const phoneI = idx(['phone', 'whatsapp', 'mobile', 'phonenumber']);
  const emailI = idx(['email']);
  const companyI = idx(['company', 'organization']);
  const tagsI = idx(['tags', 'tag', 'segment']);
  const statusI = idx(['status']);
  const agentI = idx(['assignedagent', 'agent']);
  const c1I = idx(['custom1', 'orderid', 'plan']);
  const c2I = idx(['custom2', 'city', 'amount']);
  const attUrlI = idx(['attachmenturl', 'attachment', 'fileurl']);
  const attNameI = idx(['attachmentname', 'filename']);
  const notesI = idx(['notes', 'note']);
  const lastAtI = idx(['lastmessageat', 'lastcontacted']);

  if (phoneI === -1) return [];

  const result: Contact[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const phone = normalizePhone(String(r[phoneI] || ''), defaultCountryCode);
    if (!isValidPhone(phone) || seen.has(phone)) continue;
    seen.add(phone);

    const statusRaw = statusI >= 0 ? String(r[statusI] || '').toLowerCase() : 'open';
    const status =
      statusRaw === 'pending' || statusRaw === 'resolved' ? statusRaw : 'open';
    const rawAtt = attUrlI >= 0 ? String(r[attUrlI] || '').trim() : '';

    result.push({
      id: (idI >= 0 && r[idI]) || `sheet-${phone}`,
      name: (nameI >= 0 && r[nameI]) || `Contact ${phone.slice(-4)}`,
      phone,
      email: emailI >= 0 ? String(r[emailI] || '') : '',
      company: companyI >= 0 ? String(r[companyI] || '') : '',
      tags:
        tagsI >= 0 && r[tagsI]
          ? String(r[tagsI])
              .split(/[;,]/)
              .map((t) => t.trim())
              .filter(Boolean)
          : ['Google Sheet'],
      status,
      assignedAgent: (agentI >= 0 && r[agentI]) || 'Sanket Rathod',
      custom1: c1I >= 0 ? String(r[c1I] || '') : '',
      custom2: c2I >= 0 ? String(r[c2I] || '') : '',
      attachmentUrl: isSafeHttpsUrl(rawAtt) ? rawAtt : '',
      attachmentName: attNameI >= 0 ? String(r[attNameI] || '') : '',
      notes: notesI >= 0 ? String(r[notesI] || '') : '',
      unreadCount: 0,
      lastMessagePreview: 'Synced from Google Sheets',
      lastMessageAt: (lastAtI >= 0 && r[lastAtI]) || new Date().toISOString(),
    });
  }
  return result;
}

export function logsToSheetRows(messages: ChatMessage[]): string[][] {
  return [
    [...MESSAGE_LOGS_SHEET_HEADERS],
    ...messages.map((m) => [
      m.id,
      m.timestamp,
      m.direction,
      m.phone,
      m.contactName,
      m.type,
      m.body,
      m.attachment?.name || '',
      m.attachment?.url || '',
      m.status,
      m.campaignId || '',
      m.waMessageId || '',
      m.sourceSheet || 'SNC Web App',
      m.templateName || '',
      m.category || (m.direction === 'inbound' ? 'SERVICE' : 'UTILITY'),
      m.deliveredAt || '',
      m.readAt || '',
      m.repliedAt || '',
      m.billable === false ? 'false' : 'true',
      m.estimatedCost !== undefined ? String(m.estimatedCost) : '',
      m.receiptNo || '',
      m.error || '',
    ]),
  ];
}

export function connectedSheetsToSheetRows(sheets: ExternalSheetSource[]): string[][] {
  return [
    [...CONNECTED_SHEETS_HEADERS],
    ...sheets.map((s) => [
      s.id,
      s.label,
      s.spreadsheetId,
      s.tabName,
      s.defaultTemplate,
      s.defaultCategory,
      s.colPhone,
      s.colName,
      s.colMessage,
      s.colWaId,
      s.colStatus,
      s.colTimestamp,
      s.colAttachmentUrl,
      s.colReceiptNo,
      String(s.lastSyncedRow || 0),
      s.lastSyncedAt || '',
      String(s.enabled),
    ]),
  ];
}

export function campaignsToSheetRows(campaigns: Campaign[]): string[][] {
  return [
    [...CAMPAIGNS_SHEET_HEADERS],
    ...campaigns.map((c) => [
      c.id,
      c.name,
      c.createdAt,
      String(c.totalRecipients),
      String(c.sent),
      String(c.delivered),
      String(c.failed),
      c.templateName,
      c.attachmentMode,
      c.attachmentUrl || '',
      c.status,
    ]),
  ];
}

export function templatesToSheetRows(templates: MessageTemplate[]): string[][] {
  return [
    [...TEMPLATES_SHEET_HEADERS],
    ...templates.map((t) => [
      t.id,
      t.name,
      t.category,
      t.language,
      t.headerType,
      t.headerText || '',
      t.body,
      t.footer || '',
      t.variables.join(', '),
      t.status,
      t.updatedAt,
    ]),
  ];
}

export function configToSheetRows(config: WorkspaceConfig): string[][] {
  const now = new Date().toISOString();
  return [
    [...CONFIG_SHEET_HEADERS],
    ['business_name', config.businessName, 'Workspace display brand name', now],
    ['default_country_code', config.defaultCountryCode, 'Default E.164 country dialing code', now],
    ['drive_folder_id', config.driveFolderId, 'SNC Whats App root Google Drive folder ID', now],
    ['attachments_folder_id', config.attachmentsFolderId, 'Attachments Drive subfolder ID', now],
    ['spreadsheet_id', config.spreadsheetId, 'Master Google Sheet database ID', now],
    ['apps_script_webapp_url', config.appsScriptWebAppUrl, 'Deployed Google Apps Script Web App URL', now],
    ['waba_id', config.wabaId || '', 'WhatsApp Business Account ID (for live Meta Templates)', now],
    ['rate_limit_ms', String(config.rateLimitMs), 'Delay between bulk WhatsApp messages (ms)', now],
    ['auto_log_to_sheets', String(config.autoLogToSheets), 'Auto-append outbound messages to Message_Logs', now],
    ['currency', config.pricing?.currency || 'INR', 'Dashboard spend display currency', now],
    ['rate_marketing', String(config.pricing?.marketing ?? 0.8631), 'Meta marketing message rate', now],
    ['rate_utility', String(config.pricing?.utility ?? 0.115), 'Meta utility message rate', now],
    ['rate_authentication', String(config.pricing?.authentication ?? 0.115), 'Meta authentication message rate', now],
    ['rate_service', String(config.pricing?.service ?? 0), 'Meta free 24h service window rate', now],
  ];
}

/**
 * Exports contacts to a downloadable CSV string with proper escaping.
 */
export function contactsToCsv(contacts: Contact[]): string {
  const escapeCell = (val: string) => {
    const str = String(val ?? '');
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  return contactsToSheetRows(contacts)
    .map((row) => row.map(escapeCell).join(','))
    .join('\n');
}

const MESSAGE_STATUS_RANK: Record<ChatMessage['status'], number> = {
  queued: 0,
  failed: 1,
  sent: 2,
  delivered: 3,
  read: 4,
};

/**
 * Deduplicates chat messages by `id` and non-empty `waMessageId`, preserving order
 * and retaining the highest delivery status when merging duplicates.
 */
export function dedupeMessages(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  const indexById = new Map<string, number>();
  const indexByWaId = new Map<string, number>();

  for (const msg of messages) {
    if (!msg || !msg.id) continue;
    const existingIdx =
      indexById.get(msg.id) ??
      (msg.waMessageId ? indexByWaId.get(msg.waMessageId) : undefined);

    if (existingIdx !== undefined) {
      const prev = result[existingIdx];
      const nextStatus =
        MESSAGE_STATUS_RANK[msg.status] > MESSAGE_STATUS_RANK[prev.status]
          ? msg.status
          : prev.status;
      const merged: ChatMessage = {
        ...prev,
        status: nextStatus,
        waMessageId: prev.waMessageId || msg.waMessageId,
        attachment: prev.attachment || msg.attachment,
      };
      result[existingIdx] = merged;
      indexById.set(merged.id, existingIdx);
      if (merged.waMessageId) {
        indexByWaId.set(merged.waMessageId, existingIdx);
      }
      continue;
    }

    const nextIdx = result.length;
    result.push(msg);
    indexById.set(msg.id, nextIdx);
    if (msg.waMessageId) {
      indexByWaId.set(msg.waMessageId, nextIdx);
    }
  }

  return result;
}

/**
 * Converts Google Drive view/share URLs into direct binary download URLs required by Meta Cloud API.
 */
export function normalizeDriveDownloadUrl(rawUrl: string): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return '';
  if (!isSafeHttpsUrl(trimmed)) return '';

  // Already in drive.usercontent.google.com download format
  if (trimmed.includes('drive.usercontent.google.com/download')) {
    return trimmed;
  }

  // Match /file/d/<ID>/view or /file/d/<ID>
  const fileMatch = trimmed.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch && fileMatch[1]) {
    return `https://drive.usercontent.google.com/download?id=${fileMatch[1]}&export=download&authuser=0`;
  }

  // Match ?id=<ID> or &id=<ID> on drive.google.com/open or /uc
  const idMatch = trimmed.match(/drive\.google\.com\/(?:open|uc)\?[^#]*\bid=([a-zA-Z0-9_-]+)/);
  if (idMatch && idMatch[1]) {
    return `https://drive.usercontent.google.com/download?id=${idMatch[1]}&export=download&authuser=0`;
  }

  return trimmed;
}

export interface PolicyWindowStatus {
  active: boolean;
  hours: number;
  minutes: number;
  remainingMs: number;
  lastInboundAt: string | null;
}

/**
 * Computes Meta's 24-Hour Customer Service Window from the latest inbound message timestamp.
 */
export function compute24HourWindow(
  contactMessages: ChatMessage[],
  nowMs = Date.now()
): PolicyWindowStatus {
  let latestInboundMs = 0;
  let lastInboundAt: string | null = null;

  for (const msg of contactMessages) {
    if (msg.direction !== 'inbound' || !msg.timestamp) continue;
    const ms = new Date(msg.timestamp).getTime();
    if (!Number.isNaN(ms) && ms > latestInboundMs) {
      latestInboundMs = ms;
      lastInboundAt = msg.timestamp;
    }
  }

  if (!latestInboundMs) {
    return { active: false, hours: 0, minutes: 0, remainingMs: 0, lastInboundAt: null };
  }

  const windowMs = 24 * 60 * 60 * 1000;
  const remainingMs = Math.max(0, latestInboundMs + windowMs - nowMs);
  const totalMinutes = Math.floor(remainingMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return {
    active: remainingMs > 0,
    hours,
    minutes,
    remainingMs,
    lastInboundAt,
  };
}

export interface WhatsAppFormatToken {
  type: 'text' | 'bold' | 'italic' | 'strike' | 'code' | 'link';
  value: string;
}

/**
 * Pure XSS-safe tokenizer for WhatsApp markdown (*bold*, _italic_, ~strike~, `code`, and https:// links).
 * Eliminates any need for dangerouslySetInnerHTML.
 */
export function tokenizeWhatsAppMarkdown(input: string): WhatsAppFormatToken[] {
  const text = String(input || '');
  if (!text) return [];

  const pattern = /(https:\/\/[^\s<>"]+)|(\*[^*\n]+\*)|(_[^_\n]+_)|(~[^~\n]+~)|(`[^`\n]+`)/g;
  const tokens: WhatsAppFormatToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    const raw = match[0];
    if (match[1]) {
      tokens.push({ type: 'link', value: raw });
    } else if (match[2]) {
      tokens.push({ type: 'bold', value: raw.slice(1, -1) });
    } else if (match[3]) {
      tokens.push({ type: 'italic', value: raw.slice(1, -1) });
    } else if (match[4]) {
      tokens.push({ type: 'strike', value: raw.slice(1, -1) });
    } else if (match[5]) {
      tokens.push({ type: 'code', value: raw.slice(1, -1) });
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return tokens;
}

/**
 * Generates a standard NPCI UPI payment link for 1-Tap WhatsApp billing collection.
 */
export function buildUpiPaymentLink(params: {
  vpa: string;
  payeeName: string;
  amount?: string | number;
  note?: string;
}): string {
  const vpa = (params.vpa || '').trim();
  const pn = (params.payeeName || 'SNC').trim();
  if (!vpa || !vpa.includes('@')) return '';

  const query = new URLSearchParams();
  query.set('pa', vpa);
  query.set('pn', pn);
  query.set('cu', 'INR');
  const numericAmt = Number(params.amount);
  if (!Number.isNaN(numericAmt) && numericAmt > 0) {
    query.set('am', numericAmt.toFixed(2));
  }
  if (params.note && params.note.trim()) {
    query.set('tn', params.note.trim().slice(0, 80));
  }
  return `upi://pay?${query.toString()}`;
}

// Salted SHA-256 digest for Admin Server Config unlock (plaintext PIN never stored in bundle/UI)
const ADMIN_PIN_SALT = 'snc-pin-v1:';
const ADMIN_PIN_SHA256 = '0a58c7ca8656181564218a9b30bddf4fe36832de4b7dc4c19df677a06b9bc948';

export async function verifySecurityPinHash(pinInput: string): Promise<boolean> {
  const clean = (pinInput || '').trim();
  if (!clean) return false;
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(`${ADMIN_PIN_SALT}${clean}`);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const hex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    // Constant-time comparison
    if (hex.length !== ADMIN_PIN_SHA256.length) return false;
    let diff = 0;
    for (let i = 0; i < hex.length; i++) {
      diff |= hex.charCodeAt(i) ^ ADMIN_PIN_SHA256.charCodeAt(i);
    }
    return diff === 0;
  } catch {
    return false;
  }
}

export type TemplateFieldFormat = 'text' | 'number' | 'date' | 'url';

export interface ApprovedTemplateFieldSpec {
  index: number; // 1-based positional index
  token: string; // e.g. '1' or 'name'
  label: string;
  format: TemplateFieldFormat;
  formatLabel: 'Text' | 'Number' | 'Date' | 'Link';
  example: string;
  required: boolean;
}

export interface ApprovedTemplateSchema {
  headerMediaType: 'NONE' | 'IMAGE' | 'DOCUMENT' | 'VIDEO';
  headerTextFields: ApprovedTemplateFieldSpec[];
  bodyFields: ApprovedTemplateFieldSpec[];
  buttonUrlField: ApprovedTemplateFieldSpec | null;
}

function detectFieldFormat(
  contextBefore: string,
  contextAfter: string,
  token: string,
  example = ''
): { format: TemplateFieldFormat; formatLabel: 'Text' | 'Number' | 'Date' | 'Link'; label: string } {
  const ex = (example || '').trim();
  const before = (contextBefore || '').toLowerCase();
  const after = (contextAfter || '').toLowerCase();
  const ctx = `${before} ${token.toLowerCase()} ${after}`;

  // 1. Explicit Meta example value takes highest priority
  if (/^https?:\/\//i.test(ex)) {
    return { format: 'url', formatLabel: 'Link', label: `Parameter {{${token}}} (Link)` };
  }
  if (/^\d{1,4}[-/]\d{1,2}[-/]\d{2,4}$/.test(ex)) {
    return { format: 'date', formatLabel: 'Date', label: `Parameter {{${token}}} (Date)` };
  }
  if (/^[₹$]?\s*\d[\d,]*(?:\.\d+)?$/.test(ex)) {
    return { format: 'number', formatLabel: 'Number', label: `Parameter {{${token}}} (Number)` };
  }

  // 2. Greeting / Name cue immediately before placeholder (e.g., "नमस्कार {{1}}", "Hello {{1}}")
  if (/(नमस्कार|प्रिय|\bhello\b|\bhi\b|\bdear\b|\bname\b|ग्राहक|शेतकरी|व्यापारी)\s*[:,.\-–—]*\s*$/i.test(before)) {
    return { format: 'text', formatLabel: 'Text', label: `Parameter {{${token}}} (Name / Text)` };
  }

  // 3. Link / URL detection
  if (/\b(url|link|website|pdf|drive)\b|लिंक/i.test(ctx)) {
    return { format: 'url', formatLabel: 'Link', label: `Parameter {{${token}}} (Link)` };
  }

  // 4. Date detection (Marathi दिनांक / तारीख + English date)
  if (/(दिनांक|तारीख|\bdate\b|\bdue\s*date\b|\bday\b)/i.test(ctx)) {
    return { format: 'date', formatLabel: 'Date', label: `Parameter {{${token}}} (Date)` };
  }

  // 5. Number / Amount / Receipt No detection
  if (
    /(रक्कम|रुपये|बाकी|एकूण|क्रमांक|पावती|बिल\s*नं|\bamount\b|\btotal\b|\bbalance\b|\bdue\b|\brs\.?|₹|\bqty\b|\bquantity\b|\bnumber\b|\bno\.|\bphone\b|\bmobile\b|\botp\b|\bcode\b|\bcount\b)/i.test(
      ctx
    )
  ) {
    return { format: 'number', formatLabel: 'Number', label: `Parameter {{${token}}} (Number)` };
  }

  // 6. Default Text
  const isName = /(नमस्कार|प्रिय|\bhello\b|\bhi\b|\bdear\b|\bname\b|ग्राहक|शेतकरी|व्यापारी)/i.test(ctx);
  return {
    format: 'text',
    formatLabel: 'Text',
    label: isName ? `Parameter {{${token}}} (Name / Text)` : `Parameter {{${token}}} (Text)`,
  };
}

function sliceImmediateClause(fullText: string, startPos: number, endPos: number): {
  before: string;
  after: string;
} {
  const rawBefore = fullText.slice(Math.max(0, startPos - 36), startPos);
  const nlIdx = rawBefore.lastIndexOf('\n');
  const closeIdx = rawBefore.lastIndexOf('}}');
  const dotIdx = rawBefore.lastIndexOf('. ');
  const lastBreakEnd = Math.max(
    nlIdx >= 0 ? nlIdx + 1 : -1,
    closeIdx >= 0 ? closeIdx + 2 : -1,
    dotIdx >= 0 ? dotIdx + 2 : -1
  );
  const before = lastBreakEnd >= 0 ? rawBefore.slice(lastBreakEnd) : rawBefore;

  const rawAfter = fullText.slice(endPos, endPos + 20);
  const nextBreaks = [rawAfter.indexOf('\n'), rawAfter.indexOf('{{'), rawAfter.indexOf('.')].filter(
    (i) => i >= 0
  );
  const firstBreak = nextBreaks.length > 0 ? Math.min(...nextBreaks) : rawAfter.length;
  const after = rawAfter.slice(0, firstBreak);

  return { before, after };
}

/**
 * Inspects a Meta Pre-Approved template and produces strict parameter input definitions
 * matching Meta's exact approved component count and value format (Text, Number, Date, Link, or Media Header).
 */
export function parseApprovedTemplateSchema(template: MessageTemplate): ApprovedTemplateSchema {
  const headerType = template.headerType || 'NONE';
  const headerMediaType: 'NONE' | 'IMAGE' | 'DOCUMENT' | 'VIDEO' =
    headerType === 'IMAGE' || headerType === 'DOCUMENT' || headerType === 'VIDEO'
      ? headerType
      : 'NONE';

  const headerTextFields: ApprovedTemplateFieldSpec[] = [];
  if (headerType === 'TEXT' && template.headerText) {
    const matches = Array.from(template.headerText.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g));
    const seen = new Set<string>();
    matches.forEach((m) => {
      const token = m[1];
      if (seen.has(token)) return;
      seen.add(token);
      const pos = m.index ?? 0;
      const { before, after } = sliceImmediateClause(
        template.headerText!,
        pos,
        pos + m[0].length
      );
      const meta = detectFieldFormat(before, after, token, template.headerExample || '');
      headerTextFields.push({
        index: headerTextFields.length + 1,
        token,
        label: `Header ${meta.label}`,
        format: meta.format,
        formatLabel: meta.formatLabel,
        example: template.headerExample || '',
        required: true,
      });
    });
  }

  const bodyFields: ApprovedTemplateFieldSpec[] = [];
  const bodyStr = template.body || '';
  const bodyMatches = Array.from(bodyStr.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g));
  const seenBody = new Set<string>();
  bodyMatches.forEach((m) => {
    const token = m[1];
    if (seenBody.has(token)) return;
    seenBody.add(token);
    const pos = m.index ?? 0;
    const { before, after } = sliceImmediateClause(bodyStr, pos, pos + m[0].length);
    const exVal = template.exampleValues?.[bodyFields.length] || '';
    const meta = detectFieldFormat(before, after, token, exVal);
    bodyFields.push({
      index: bodyFields.length + 1,
      token,
      label: meta.label,
      format: meta.format,
      formatLabel: meta.formatLabel,
      example: exVal,
      required: true,
    });
  });

  let buttonUrlField: ApprovedTemplateFieldSpec | null = null;
  const dynamicBtn = (template.buttons || []).find(
    (b) => b.type === 'URL' && b.url && /\{\{\s*1\s*\}\}/.test(b.url)
  );
  if (dynamicBtn) {
    buttonUrlField = {
      index: 1,
      token: '1',
      label: `Button "${dynamicBtn.text}" Dynamic URL Suffix`,
      format: 'url',
      formatLabel: 'Link',
      example: dynamicBtn.url || '',
      required: true,
    };
  }

  return {
    headerMediaType,
    headerTextFields,
    bodyFields,
    buttonUrlField,
  };
}

/**
 * Renders the locked preview text of a pre-approved template with exact user-entered parameter values.
 */
export function renderApprovedTemplatePreview(
  template: MessageTemplate,
  bodyValues: string[],
  headerValues: string[] = []
): { headerPreview?: string; bodyPreview: string } {
  const schema = parseApprovedTemplateSchema(template);
  const bodyMap = new Map<string, string>();
  schema.bodyFields.forEach((field, idx) => {
    bodyMap.set(field.token, (bodyValues[idx] || '').trim());
  });
  const bodyPreview = (template.body || '').replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_m, token: string) => bodyMap.get(token) || `{{${token}}}`
  );

  let headerPreview = template.headerText;
  if (template.headerType === 'TEXT' && template.headerText) {
    const headerMap = new Map<string, string>();
    schema.headerTextFields.forEach((field, idx) => {
      headerMap.set(field.token, (headerValues[idx] || '').trim());
    });
    headerPreview = template.headerText.replace(
      /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
      (_m, token: string) => headerMap.get(token) || `{{${token}}}`
    );
  }

  return { headerPreview, bodyPreview };
}

/**
 * Converts a Google Drive file URL into a reliable inline image thumbnail URL for Inbox preview,
 * while preserving original URLs for non-Drive images.
 */
export function getDriveViewableThumbnailUrl(rawUrl: string): string {
  const url = (rawUrl || '').trim();
  if (!url) return '';
  const m1 = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m1?.[1]) return `https://drive.google.com/thumbnail?id=${m1[1]}&sz=w1000`;
  const m2 = url.match(/(?:drive\.google\.com|drive\.usercontent\.google\.com)\/(?:open|uc|download)\?[^#]*\bid=([a-zA-Z0-9_-]+)/);
  if (m2?.[1]) return `https://drive.google.com/thumbnail?id=${m2[1]}&sz=w1000`;
  return url;
}

/**
 * Converts a Google Drive download/uc URL into a clean Google Drive browser viewer URL.
 */
export function getDriveBrowserViewUrl(rawUrl: string): string {
  const url = (rawUrl || '').trim();
  if (!url) return '';
  const m1 = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m1?.[1]) return `https://drive.google.com/file/d/${m1[1]}/view`;
  const m2 = url.match(/(?:drive\.google\.com|drive\.usercontent\.google\.com)\/(?:open|uc|download|thumbnail)\?[^#]*\bid=([a-zA-Z0-9_-]+)/);
  if (m2?.[1]) return `https://drive.google.com/file/d/${m2[1]}/view`;
  return url;
}

export const SAMPLE_CONTACTS_CSV = `id,name,phone,email,company,tags,status,assigned_agent,custom1,custom2,attachment_url,attachment_name,notes
cnt-101,Priya Sharma,919820114422,priya@apextextiles.in,Apex Textiles,VIP;Wholesale,open,Sanket Rathod,ORD-4821,Mumbai,https://drive.google.com/file/d/invoice-4821/view,Invoice_4821.pdf,Prefers GST invoice before 4 PM
cnt-102,Arjun Mehta,919811447788,arjun@swiftfreight.com,SwiftFreight,Enterprise;Logistics,open,Sanket Rathod,SHP-9094,Pune,https://drive.google.com/file/d/manifest-9094/view,Manifest_9094.pdf,Dispatch tracking enabled
cnt-103,Kavita Nair,919845229901,kavita@techsol.com,TechSol India,Retail;Active,resolved,Sanket Rathod,SUB-1024,Bengaluru,,,Annual maintenance client
cnt-104,Rahul Verma,919890123456,rahul@vermatraders.com,Verma Traders,Lead;New,pending,Sanket Rathod,INV-3091,Delhi,,,Follow up on quotation
cnt-105,Deepak Patil,919765432100,deepak@patileng.in,Patil Engineering,Wholesale,open,Sanket Rathod,QUO-7721,Nagpur,,,Catalog sent on WhatsApp`;

export const SAMPLE_WATI_BULK_CSV = `phone,name,custom1,custom2,attachment_url,notes
919820114422,Priya Sharma,ORD-4821,Mumbai,https://drive.google.com/file/d/sample-invoice-4821/view,Wholesale client - send GST invoice
919811447788,Arjun Mehta,SHP-9094,Pune,https://drive.google.com/file/d/sample-manifest-9094/view,Logistics partner - dispatch manifest
919845229901,Kavita Nair,SUB-1024,Bengaluru,,Monthly subscriber renewal
919890123456,Rahul Verma,INV-3091,Delhi,https://drive.google.com/file/d/sample-receipt-3091/view,Payment acknowledgment
919765432100,Deepak Patil,QUO-7721,Nagpur,,Festive offer catalog recipient`;


