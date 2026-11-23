export interface AppsScriptGeneratorOptions {
  spreadsheetId?: string;
  folderId?: string;
  attachmentsFolderId?: string;
  businessName?: string;
  webhookVerifyToken?: string;
  wabaId?: string;
  phoneId?: string;
  apiVersion?: string;
  masterWebAppUrl?: string;
}

/**
 * Generates Gateway_Code.gs — the Primary Master Serverless Gateway for SNC WhatsApp Business Suite.
 *
 * Enterprise Security & Capabilities:
 * - Zero hardcoded secrets: WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_WABA_ID,
 *   WEBHOOK_VERIFY_TOKEN, and SNC_APP_SECRET_KEY live strictly in PropertiesService.getScriptProperties().
 * - 8-Tab Master Sheet Schema: Contacts, Message_Logs, Campaigns, Templates, Config, Bulk_Queue,
 *   Connected_Sheets, Shards_Registry.
 * - Passwordless 6-Digit WhatsApp OTP Auth via CacheService (5-minute TTL) for authorized admins.
 * - Meta Webhook receiver + Self-Service Receipt Bot ("Bill"/"Receipt"/"खाते"/"पावती") +
 *   Automated #opt_out Compliance Engine ("STOP"/"UNSUBSCRIBE").
 * - CORS-safe text/plain JSON API Router for GitHub Pages & Netlify static deployments.
 */
export function generateGatewayAppsScriptCode(options: AppsScriptGeneratorOptions = {}): string {
  const folderId = (options.folderId || '').trim();
  const businessName = (
    options.businessName?.trim() || 'SNC WhatsApp Business'
  ).replace(/'/g, "\\'");
  const apiVersion = (options.apiVersion?.trim() || 'v25.0').replace(/'/g, "\\'");

  return `/**
 * ============================================================================
 * ${businessName} — Gateway_Code.gs (Master Serverless Gateway)
 * ============================================================================
 * 100% Free Serverless Backend: Google Sheets + Google Drive + Apps Script + Meta Cloud API ${apiVersion}
 * Compatible with GitHub Pages & Netlify static deployments.
 *
 * ZERO HARDCODED SECRETS OR KEYS:
 *   Configure all keys strictly inside Apps Script -> Project Settings -> Script Properties:
 *     - DRIVE_FOLDER_ID        : (auto-detected from Master Sheet parent folder, or paste Folder ID)
 *     - SPREADSHEET_ID         : (auto-detected if bound, or paste Master Sheet ID)
 *     - ATTACHMENTS_FOLDER_ID  : (auto-created inside DRIVE_FOLDER_ID if blank)
 *     - WHATSAPP_ACCESS_TOKEN  : Your permanent Meta System User Access Token
 *     - WHATSAPP_PHONE_ID      : Your Meta WhatsApp Phone Number ID
 *     - WHATSAPP_WABA_ID       : Your Meta WhatsApp Business Account (WABA) ID
 *     - WEBHOOK_VERIFY_TOKEN   : Your custom Meta Webhook Verify Token
 *
 * Deployment:
 *   Deploy -> Manage deployments -> Edit -> Version: New version
 *     Execute as: Me
 *     Who has access: Anyone
 */

const SNC_CONFIG = {
  BUSINESS_NAME: '${businessName}',
  DEFAULT_DRIVE_FOLDER_ID: '${folderId}',
  DEFAULT_API_VERSION: '${apiVersion}',
  AUTHORIZED_ADMINS: [
    { phone: '919975649575', name: 'Parag Sureshrao Chaware', role: 'ADMIN' },
    { phone: '917020178679', name: 'Sanket Rathod', role: 'ADMIN' },
    { phone: '919922775569', name: 'Authorized Admin', role: 'ADMIN' },
  ],
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('SNC WhatsApp')
    .addItem('1. Initialize All 8 Tabs & Headers', 'setupSncSheets')
    .addItem('2. Configure WhatsApp API Properties', 'promptCredentialsSetup')
    .addSeparator()
    .addItem('Sync Pre-Approved Templates from Meta', 'syncMetaTemplatesToSheet')
    .addItem('Sync Connected External Receipt Sheets', 'syncExternalSheetsNow')
    .addItem('Install 10-Min External Sheet Sync Trigger', 'installAutoSyncTrigger')
    .addSeparator()
    .addItem('Verify Drive Folder & Attachments', 'verifyDriveStructure')
    .addToUi();
}

/**
 * Stores Meta WhatsApp secrets strictly in Google Script Properties (zero hardcoded secrets).
 */
function promptCredentialsSetup() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();

  const phonePrompt = ui.prompt(
    'SNC WhatsApp — Phone Number ID',
    'Enter your Meta WhatsApp Phone Number ID:',
    ui.ButtonSet.OK_CANCEL
  );
  if (phonePrompt.getSelectedButton() !== ui.Button.OK) return;

  const wabaPrompt = ui.prompt(
    'SNC WhatsApp — WhatsApp Business Account ID (WABA ID)',
    'Enter your Meta WABA ID:',
    ui.ButtonSet.OK_CANCEL
  );
  if (wabaPrompt.getSelectedButton() !== ui.Button.OK) return;

  const tokenPrompt = ui.prompt(
    'SNC WhatsApp — Permanent System User Access Token',
    'Paste your Meta WhatsApp Business Cloud API Access Token (stored encrypted in Script Properties):',
    ui.ButtonSet.OK_CANCEL
  );
  if (tokenPrompt.getSelectedButton() !== ui.Button.OK) return;

  const verifyPrompt = ui.prompt(
    'SNC WhatsApp — Meta Webhook Verify Token',
    'Enter your Meta Webhook Verify Token:',
    ui.ButtonSet.OK_CANCEL
  );
  if (verifyPrompt.getSelectedButton() !== ui.Button.OK) return;

  const updates = {
    DRIVE_FOLDER_ID: props.getProperty('DRIVE_FOLDER_ID') || SNC_CONFIG.DEFAULT_DRIVE_FOLDER_ID,
  };
  if (phonePrompt.getResponseText().trim()) updates.WHATSAPP_PHONE_ID = phonePrompt.getResponseText().trim();
  if (wabaPrompt.getResponseText().trim()) updates.WHATSAPP_WABA_ID = wabaPrompt.getResponseText().trim();
  if (tokenPrompt.getResponseText().trim()) updates.WHATSAPP_ACCESS_TOKEN = tokenPrompt.getResponseText().trim();
  if (verifyPrompt.getResponseText().trim()) updates.WEBHOOK_VERIFY_TOKEN = verifyPrompt.getResponseText().trim();

  props.setProperties(updates);
  ui.alert('Saved securely to Apps Script Properties.');
}

/**
 * Initializes all 8 Master Spreadsheet tabs with emerald headers.
 */
function setupSncSheets() {
  const ss = getMasterSpreadsheet_();
  const schemas = {
    Contacts: [
      'id', 'name', 'phone', 'email', 'company', 'tags', 'status',
      'assigned_agent', 'custom1', 'custom2', 'attachment_url',
      'attachment_name', 'notes', 'last_message_at',
    ],
    Message_Logs: [
      'message_id', 'timestamp', 'direction', 'phone', 'contact_name',
      'type', 'body', 'attachment_name', 'attachment_url', 'status',
      'campaign_id', 'wa_message_id', 'source_sheet', 'template_name',
      'category', 'delivered_at', 'read_at', 'replied_at', 'billable',
      'estimated_cost', 'receipt_no', 'error_message',
    ],
    Campaigns: [
      'campaign_id', 'name', 'created_at', 'total_recipients', 'sent',
      'delivered', 'failed', 'template_name', 'attachment_mode',
      'attachment_url', 'status',
    ],
    Templates: [
      'template_id', 'name', 'category', 'language', 'header_type',
      'header_text', 'body', 'footer', 'variables', 'status', 'updated_at',
    ],
    Config: ['key', 'value', 'description', 'updated_at'],
    Bulk_Queue: [
      'queue_id', 'campaign_id', 'phone', 'name', 'message', 'template_name',
      'attachment_url', 'attachment_type', 'attachment_name', 'status',
      'wa_message_id', 'sent_at', 'error_message',
    ],
    Connected_Sheets: [
      'sheet_link_id', 'label', 'spreadsheet_id', 'tab_name',
      'default_template', 'default_category', 'col_phone', 'col_name',
      'col_message', 'col_wa_id', 'col_status', 'col_timestamp',
      'col_attachment_url', 'col_receipt_no', 'last_synced_row',
      'last_synced_at', 'enabled',
    ],
    Shards_Registry: [
      'shard_id', 'spreadsheet_id', 'spreadsheet_url', 'row_count',
      'archived_at', 'date_range',
    ],
  };

  const created = [];
  Object.keys(schemas).forEach(function (sheetName) {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      created.push(sheetName);
    }
    const headers = schemas[sheetName];
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length)
        .setFontWeight('bold')
        .setBackground('#075E54')
        .setFontColor('#FFFFFF');
      sheet.setFrozenRows(1);
    }
  });

  ensureDriveFolders_();
  return {
    spreadsheetId: ss.getId(),
    spreadsheetUrl: ss.getUrl(),
    tabsCreated: created,
  };
}

function verifyDriveStructure() {
  const folders = ensureDriveFolders_();
  SpreadsheetApp.getUi().alert(
    'Drive verified:\\nRoot: ' + folders.root.getUrl() + '\\nAttachments: ' + folders.attachments.getUrl()
  );
}

function ensureDriveFolders_() {
  const props = PropertiesService.getScriptProperties();
  const rootFolderId = String(
    props.getProperty('DRIVE_FOLDER_ID') || SNC_CONFIG.DEFAULT_DRIVE_FOLDER_ID || ''
  ).trim();
  let root = null;
  if (rootFolderId) {
    try {
      root = DriveApp.getFolderById(rootFolderId);
    } catch (e) {
      root = null;
    }
  }
  // Auto-detect parent Drive folder of the bound Master Spreadsheet if DRIVE_FOLDER_ID is not set
  if (!root) {
    try {
      const ss = getMasterSpreadsheet_();
      const parents = DriveApp.getFileById(ss.getId()).getParents();
      if (parents.hasNext()) {
        root = parents.next();
        props.setProperty('DRIVE_FOLDER_ID', root.getId());
      }
      if (!props.getProperty('SPREADSHEET_ID')) {
        props.setProperty('SPREADSHEET_ID', ss.getId());
      }
    } catch (parentErr) {
      Logger.log('Parent folder auto-detect skipped: ' + parentErr.message);
    }
  }
  if (!root) {
    const found = DriveApp.getFoldersByName('SNC Whats App');
    root = found.hasNext() ? found.next() : DriveApp.createFolder('SNC Whats App');
    props.setProperty('DRIVE_FOLDER_ID', root.getId());
  }

  const attFolderId = String(props.getProperty('ATTACHMENTS_FOLDER_ID') || '').trim();
  let attachments;
  try {
    if (!attFolderId) throw new Error('missing');
    attachments = DriveApp.getFolderById(attFolderId);
  } catch (e) {
    const foundAtt = root.getFoldersByName('Attachments');
    attachments = foundAtt.hasNext() ? foundAtt.next() : root.createFolder('Attachments');
    props.setProperty('ATTACHMENTS_FOLDER_ID', attachments.getId());
  }
  return { root: root, attachments: attachments };
}

function getApiCreds_() {
  const props = PropertiesService.getScriptProperties();
  return {
    accessToken: String(props.getProperty('WHATSAPP_ACCESS_TOKEN') || '').trim(),
    phoneId: String(props.getProperty('WHATSAPP_PHONE_ID') || '').trim(),
    wabaId: String(props.getProperty('WHATSAPP_WABA_ID') || '').trim(),
    verifyToken: String(props.getProperty('WEBHOOK_VERIFY_TOKEN') || '').trim(),
    apiKey: String(props.getProperty('SNC_APP_SECRET_KEY') || '').trim(),
    apiVersion: String(
      props.getProperty('WHATSAPP_API_VERSION') || SNC_CONFIG.DEFAULT_API_VERSION || 'v25.0'
    ).trim(),
    driveFolderId: String(
      props.getProperty('DRIVE_FOLDER_ID') || SNC_CONFIG.DEFAULT_DRIVE_FOLDER_ID || ''
    ).trim(),
    spreadsheetId: String(props.getProperty('SPREADSHEET_ID') || '').trim(),
  };
}

function checkApiKey_(providedKey) {
  const creds = getApiCreds_();
  if (!creds.apiKey) return true;
  return String(providedKey || '').trim() === creds.apiKey;
}

function extractDriveFileId_(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url) return '';
  const m1 = url.match(/drive\\.google\\.com\\/file\\/d\\/([a-zA-Z0-9_-]+)/);
  if (m1 && m1[1]) return m1[1];
  const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m2 && m2[1] && url.indexOf('google.com') >= 0) return m2[1];
  return '';
}

/**
 * Converts Google Drive view/open URLs into direct binary download URLs for Meta WhatsApp API.
 */
function normalizeDriveUrl_(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url) return '';
  if (url.indexOf('drive.usercontent.google.com/download') >= 0) return url;
  const fileId = extractDriveFileId_(url);
  if (fileId) {
    return 'https://drive.usercontent.google.com/download?id=' + fileId + '&export=download&authuser=0';
  }
  return url;
}

/**
 * Guarantees exact MIME type and file extension (prevents WhatsApp showing PDFs as .bin files).
 */
function resolveMediaFilenameAndMime_(blob, preferredName, mediaKind) {
  const kind = String(mediaKind || 'document').toLowerCase();
  const rawName = String(preferredName || (blob && blob.getName()) || '').trim();
  let safeName = rawName.replace(/[\\\\/:*?"<>|]/g, '_');
  let rawMime = String((blob && blob.getContentType()) || '').split(';')[0].trim().toLowerCase();

  // Detect PDF magic header (%PDF) directly from binary bytes
  let isPdfBytes = false;
  try {
    const bytes = blob.getBytes();
    if (
      bytes &&
      bytes.length >= 4 &&
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46
    ) {
      isPdfBytes = true;
    }
  } catch (e) {
    // Ignore byte inspection errors
  }

  const extMimeMap = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    csv: 'text/plain',
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

  const extMatch = safeName.match(/\\.([a-zA-Z0-9]+)$/);
  const ext = extMatch ? extMatch[1].toLowerCase() : '';

  if (isPdfBytes || ext === 'pdf' || rawMime === 'application/pdf') {
    rawMime = 'application/pdf';
    if (!safeName || /\\.bin$/i.test(safeName)) {
      safeName = (safeName.replace(/\\.bin$/i, '') || 'SNC_Document') + '.pdf';
    } else if (!/\\.pdf$/i.test(safeName)) {
      safeName = safeName + '.pdf';
    }
  } else if (ext && extMimeMap[ext]) {
    rawMime = extMimeMap[ext];
  } else if (kind === 'document') {
    if (!rawMime || rawMime === 'application/octet-stream' || rawMime === 'binary/octet-stream') {
      rawMime = 'application/pdf';
    }
    if (!safeName || /\\.bin$/i.test(safeName) || !/\\.[a-zA-Z0-9]{2,5}$/.test(safeName)) {
      safeName = (safeName.replace(/\\.bin$/i, '') || 'SNC_Document') + '.pdf';
    }
  } else if (kind === 'image') {
    if (!rawMime || rawMime.indexOf('image/') !== 0) rawMime = 'image/jpeg';
    if (!safeName || /\\.bin$/i.test(safeName)) safeName = 'SNC_Image.jpg';
  } else if (kind === 'video') {
    if (!rawMime || rawMime.indexOf('video/') !== 0) rawMime = 'video/mp4';
    if (!safeName || /\\.bin$/i.test(safeName)) safeName = 'SNC_Video.mp4';
  } else if (kind === 'audio') {
    if (!rawMime || rawMime.indexOf('audio/') !== 0) rawMime = 'audio/mpeg';
    if (!safeName || /\\.bin$/i.test(safeName)) safeName = 'SNC_Audio.mp3';
  }

  return { filename: safeName, mimeType: rawMime };
}

/**
 * Builds an exact RFC-2046 multipart/form-data byte array with explicit Content-Type on the file part.
 * Prevents Google Apps Script UrlFetchApp from downgrading PDF/TXT/Excel blobs to application/octet-stream (BIN on Android).
 */
function buildMetaMultipartBytes_(boundary, mimeType, filename, fileBytes) {
  const safeHeaderName = String(filename || 'SNC_Document.pdf')
    .replace(/[\\r\\n"]/g, '_')
    .trim();
  const crlf = '\\r\\n';
  let headerPart = '';
  headerPart += '--' + boundary + crlf;
  headerPart += 'Content-Disposition: form-data; name="messaging_product"' + crlf + crlf;
  headerPart += 'whatsapp' + crlf;
  headerPart += '--' + boundary + crlf;
  headerPart += 'Content-Disposition: form-data; name="type"' + crlf + crlf;
  headerPart += mimeType + crlf;
  headerPart += '--' + boundary + crlf;
  headerPart +=
    'Content-Disposition: form-data; name="file"; filename="' + safeHeaderName + '"' + crlf;
  headerPart += 'Content-Type: ' + mimeType + crlf + crlf;

  const footerPart = crlf + '--' + boundary + '--' + crlf;
  return Utilities.newBlob(headerPart)
    .getBytes()
    .concat(fileBytes)
    .concat(Utilities.newBlob(footerPart).getBytes());
}

/**
 * Uploads a Blob directly to Meta Cloud API /{PHONE_ID}/media using explicit byte-level multipart/form-data
 * so PDF, TXT, Excel, Word, and PowerPoint files always carry their exact MIME type on Android & Web WhatsApp.
 */
function uploadBlobToMetaMultipart_(creds, blob, preferredName, mediaKind) {
  if (!blob || !creds || !creds.accessToken || !creds.phoneId) {
    return { ok: false, error: 'Missing Meta credentials or file blob.' };
  }
  try {
    const resolved = resolveMediaFilenameAndMime_(blob, preferredName, mediaKind);
    const fileBytes = blob.getBytes();
    const boundary = 'SncWaBoundary_' + Utilities.getUuid().replace(/-/g, '');
    const payloadBytes = buildMetaMultipartBytes_(
      boundary,
      resolved.mimeType,
      resolved.filename,
      fileBytes
    );
    const uploadEndpoint =
      'https://graph.facebook.com/' + creds.apiVersion + '/' + creds.phoneId + '/media';

    const uploadRes = UrlFetchApp.fetch(uploadEndpoint, {
      method: 'post',
      contentType: 'multipart/form-data; boundary=' + boundary,
      headers: { Authorization: 'Bearer ' + creds.accessToken },
      payload: payloadBytes,
      muteHttpExceptions: true,
    });
    const code = uploadRes.getResponseCode();
    const rawText = uploadRes.getContentText() || '{}';
    const parsed = JSON.parse(rawText);
    if (code >= 200 && code < 300 && parsed.id) {
      return {
        ok: true,
        mediaId: String(parsed.id),
        filename: resolved.filename,
        mimeType: resolved.mimeType,
      };
    }
    const errMsg =
      (parsed.error && parsed.error.message) || 'HTTP ' + code + ': ' + rawText.slice(0, 220);
    Logger.log('Meta /media manual multipart upload failed: ' + errMsg);
    return { ok: false, error: errMsg };
  } catch (err) {
    Logger.log('Meta /media manual multipart upload error: ' + err.message);
    return { ok: false, error: err.message || 'Meta media upload exception.' };
  }
}

/**
 * Fetches Drive/HTTPS media binary and uploads directly to Meta Cloud API /{PHONE_ID}/media
 * with explicit Content-Type so Android WhatsApp opens PDF/TXT/Excel natively instead of .BIN.
 */
function uploadMediaToMeta_(creds, mediaUrl, preferredName, mediaKind) {
  if (!mediaUrl || !creds.accessToken || !creds.phoneId) {
    return { ok: false, error: 'Missing media URL or Meta credentials.' };
  }
  try {
    let blob = null;
    const driveId = extractDriveFileId_(mediaUrl);
    if (driveId) {
      const driveFile = DriveApp.getFileById(driveId);
      blob = driveFile.getBlob();
      if (!preferredName) preferredName = driveFile.getName();
    } else {
      const fetchRes = UrlFetchApp.fetch(mediaUrl, { muteHttpExceptions: true });
      if (fetchRes.getResponseCode() < 200 || fetchRes.getResponseCode() >= 300) {
        return {
          ok: false,
          error: 'Source URL returned HTTP ' + fetchRes.getResponseCode(),
        };
      }
      blob = fetchRes.getBlob();
    }
    return uploadBlobToMetaMultipart_(creds, blob, preferredName, mediaKind);
  } catch (err) {
    Logger.log('Meta /media fetch/upload error: ' + err.message);
    return { ok: false, error: err.message || 'Failed reading media file for Meta upload.' };
  }
}

/**
 * Passwordless 6-Digit WhatsApp OTP Generation (stored 5 min in CacheService with 30s cooldown).
 */
function handleSendOtp_(rawPhone) {
  const cleanPhone = String(rawPhone || '').replace(/\\D/g, '');
  const admin = SNC_CONFIG.AUTHORIZED_ADMINS.find(function (u) {
    return u.phone === cleanPhone;
  });
  if (!admin) {
    return { ok: false, error: 'Phone number is not on the SNC Authorized Operators list.' };
  }
  const cache = CacheService.getScriptCache();
  if (cache.get('snc_otp_cd_' + cleanPhone)) {
    return { ok: false, error: 'Please wait 30 seconds before requesting another OTP.' };
  }
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  cache.put('snc_otp_' + cleanPhone, otp, 300);
  cache.put('snc_otp_cd_' + cleanPhone, '1', 30);
  cache.remove('snc_otp_tries_' + cleanPhone);

  sendWhatsAppMessage({
    to: cleanPhone,
    type: 'text',
    body:
      '*SNC WhatsApp Security Code:* ' +
      otp +
      '\\nValid for 5 minutes. Do not share this login OTP with anyone.',
  });

  return {
    ok: true,
    expiresInSec: 300,
    maskedPhone: '+91 ••••••' + cleanPhone.slice(-4),
  };
}

function handleVerifyOtp_(rawPhone, otpInput) {
  const cleanPhone = String(rawPhone || '').replace(/\\D/g, '');
  const admin = SNC_CONFIG.AUTHORIZED_ADMINS.find(function (u) {
    return u.phone === cleanPhone;
  });
  if (!admin) {
    return { ok: false, error: 'Unauthorized operator phone.' };
  }
  const cache = CacheService.getScriptCache();
  const expected = cache.get('snc_otp_' + cleanPhone);
  const entered = String(otpInput || '').trim();
  if (!expected || !/^\\d{6}$/.test(entered) || entered !== expected) {
    const tries = Number(cache.get('snc_otp_tries_' + cleanPhone) || '0') + 1;
    if (tries >= 5) {
      cache.remove('snc_otp_' + cleanPhone);
      cache.remove('snc_otp_tries_' + cleanPhone);
      return {
        ok: false,
        error: 'Too many invalid attempts. OTP invalidated — request a new 6-digit code.',
      };
    }
    cache.put('snc_otp_tries_' + cleanPhone, String(tries), 300);
    return { ok: false, error: 'Invalid or expired 6-digit OTP. Request a fresh code.' };
  }
  cache.remove('snc_otp_' + cleanPhone);
  cache.remove('snc_otp_tries_' + cleanPhone);
  const token =
    Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  cache.put('snc_session_' + token, JSON.stringify(admin), 21600);
  return {
    ok: true,
    sessionToken: token,
    user: admin,
  };
}

function requireOtpSession_(rawToken) {
  const token = String(rawToken || '').trim();
  if (!token || token.length < 32) {
    return {
      ok: false,
      authExpired: true,
      error: 'Session expired or unauthorized. Please sign in with WhatsApp OTP.',
    };
  }
  const cache = CacheService.getScriptCache();
  const cached = cache.get('snc_session_' + token);
  if (!cached) {
    return {
      ok: false,
      authExpired: true,
      error: 'Session expired or unauthorized. Please sign in with WhatsApp OTP.',
    };
  }
  try {
    return { ok: true, user: JSON.parse(cached) };
  } catch (e) {
    return {
      ok: false,
      authExpired: true,
      error: 'Session expired or unauthorized. Please sign in with WhatsApp OTP.',
    };
  }
}

function handleLogout_(rawToken) {
  const token = String(rawToken || '').trim();
  if (token) {
    CacheService.getScriptCache().remove('snc_session_' + token);
  }
  return { ok: true };
}

/**
 * Sends text, template, or normalized Drive attachment via Meta WhatsApp Cloud API ${apiVersion}.
 */
function sendWhatsAppMessage(opts) {
  const creds = getApiCreds_();
  if (!creds.accessToken || !creds.phoneId) {
    throw new Error('Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_ID in Script Properties first.');
  }

  const cleanPhone = String(opts.to || '').replace(/\\D/g, '');
  const type = String(opts.type || 'text').toLowerCase();
  const bodyText = String(opts.body || '').slice(0, 4096);
  const directMediaUrl = normalizeDriveUrl_(opts.attachmentUrl || '');
  const endpoint =
    'https://graph.facebook.com/' + creds.apiVersion + '/' + creds.phoneId + '/messages';

  const safeDocName = (function () {
    const base = String(opts.attachmentName || 'SNC_Document.pdf').trim().replace(/\\.bin$/i, '');
    return /\\.[a-zA-Z0-9]{2,5}$/.test(base) ? base : base + '.pdf';
  })();

  let payload;
  if (type === 'template' && opts.templateName) {
    const components = [];
    const headerType = String(opts.templateHeaderType || '').toUpperCase();

    if ((headerType === 'DOCUMENT' || (!headerType && directMediaUrl)) && (opts.mediaId || directMediaUrl)) {
      const uploadedDoc = !opts.mediaId && directMediaUrl
        ? uploadMediaToMeta_(creds, directMediaUrl, safeDocName, 'document')
        : null;
      if (!opts.mediaId && (!uploadedDoc || !uploadedDoc.ok) && extractDriveFileId_(directMediaUrl)) {
        return {
          ok: false,
          status: 'failed',
          error:
            'Document upload to Meta /media failed (blocked Drive BIN fallback): ' +
            ((uploadedDoc && uploadedDoc.error) || 'Unable to upload Drive document.'),
        };
      }
      const docObj = opts.mediaId
        ? { id: String(opts.mediaId), filename: safeDocName }
        : uploadedDoc && uploadedDoc.ok
          ? { id: uploadedDoc.mediaId, filename: uploadedDoc.filename }
          : { link: directMediaUrl, filename: safeDocName };
      components.push({
        type: 'header',
        parameters: [{ type: 'document', document: docObj }],
      });
    } else if (headerType === 'IMAGE' && (opts.mediaId || directMediaUrl)) {
      const uploadedImg = !opts.mediaId && directMediaUrl
        ? uploadMediaToMeta_(creds, directMediaUrl, opts.attachmentName, 'image')
        : null;
      components.push({
        type: 'header',
        parameters: [
          {
            type: 'image',
            image: opts.mediaId
              ? { id: String(opts.mediaId) }
              : uploadedImg && uploadedImg.ok
                ? { id: uploadedImg.mediaId }
                : { link: directMediaUrl },
          },
        ],
      });
    } else if (headerType === 'VIDEO' && (opts.mediaId || directMediaUrl)) {
      const uploadedVid = !opts.mediaId && directMediaUrl
        ? uploadMediaToMeta_(creds, directMediaUrl, opts.attachmentName, 'video')
        : null;
      components.push({
        type: 'header',
        parameters: [
          {
            type: 'video',
            video: opts.mediaId
              ? { id: String(opts.mediaId) }
              : uploadedVid && uploadedVid.ok
                ? { id: uploadedVid.mediaId }
                : { link: directMediaUrl },
          },
        ],
      });
    } else if (headerType === 'TEXT' && Array.isArray(opts.templateHeaderParams) && opts.templateHeaderParams.length > 0) {
      components.push({
        type: 'header',
        parameters: opts.templateHeaderParams.map(function (v) {
          return { type: 'text', text: String(v || '') };
        }),
      });
    }

    const params = Array.isArray(opts.templateParams)
      ? opts.templateParams.slice(0, 15).map(function (v) {
          return { type: 'text', text: String(v == null ? '' : v) };
        })
      : [];
    if (params.length > 0) {
      components.push({ type: 'body', parameters: params });
    }

    if (Array.isArray(opts.templateButtonParams) && opts.templateButtonParams.length > 0) {
      components.push({
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: String(opts.templateButtonParams[0] || '') }],
      });
    }

    payload = {
      messaging_product: 'whatsapp',
      to: cleanPhone,
      type: 'template',
      template: {
        name: String(opts.templateName).trim(),
        language: { code: String(opts.templateLanguage || 'en_US').trim() },
      },
    };
    if (components.length > 0) payload.template.components = components;
  } else if (type === 'image' && (opts.mediaId || directMediaUrl)) {
    const uploadedImg = !opts.mediaId && directMediaUrl
      ? uploadMediaToMeta_(creds, directMediaUrl, opts.attachmentName, 'image')
      : null;
    const imgObj = opts.mediaId
      ? { id: String(opts.mediaId) }
      : uploadedImg && uploadedImg.ok
        ? { id: uploadedImg.mediaId }
        : { link: directMediaUrl };
    if (bodyText) imgObj.caption = bodyText;
    payload = {
      messaging_product: 'whatsapp',
      to: cleanPhone,
      type: 'image',
      image: imgObj,
    };
  } else if (type === 'video' && (opts.mediaId || directMediaUrl)) {
    const uploadedVid = !opts.mediaId && directMediaUrl
      ? uploadMediaToMeta_(creds, directMediaUrl, opts.attachmentName, 'video')
      : null;
    const vidObj = opts.mediaId
      ? { id: String(opts.mediaId) }
      : uploadedVid && uploadedVid.ok
        ? { id: uploadedVid.mediaId }
        : { link: directMediaUrl };
    if (bodyText) vidObj.caption = bodyText;
    payload = {
      messaging_product: 'whatsapp',
      to: cleanPhone,
      type: 'video',
      video: vidObj,
    };
  } else if (type === 'audio' && (opts.mediaId || directMediaUrl)) {
    const uploadedAud = !opts.mediaId && directMediaUrl
      ? uploadMediaToMeta_(creds, directMediaUrl, opts.attachmentName, 'audio')
      : null;
    payload = {
      messaging_product: 'whatsapp',
      to: cleanPhone,
      type: 'audio',
      audio: opts.mediaId
        ? { id: String(opts.mediaId) }
        : uploadedAud && uploadedAud.ok
          ? { id: uploadedAud.mediaId }
          : { link: directMediaUrl },
    };
  } else if (type === 'document' && (opts.mediaId || directMediaUrl)) {
    const uploadedDoc = !opts.mediaId && directMediaUrl
      ? uploadMediaToMeta_(creds, directMediaUrl, safeDocName, 'document')
      : null;
    if (!opts.mediaId && (!uploadedDoc || !uploadedDoc.ok) && extractDriveFileId_(directMediaUrl)) {
      return {
        ok: false,
        status: 'failed',
        error:
          'Document upload to Meta /media failed (blocked Drive BIN fallback): ' +
          ((uploadedDoc && uploadedDoc.error) || 'Unable to upload Drive document.'),
      };
    }
    const docObj = opts.mediaId
      ? { id: String(opts.mediaId), filename: safeDocName }
      : uploadedDoc && uploadedDoc.ok
        ? { id: uploadedDoc.mediaId, filename: uploadedDoc.filename }
        : { link: directMediaUrl, filename: safeDocName };
    if (bodyText) docObj.caption = bodyText;
    payload = {
      messaging_product: 'whatsapp',
      to: cleanPhone,
      type: 'document',
      document: docObj,
    };
  } else {
    payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'text',
      text: { preview_url: true, body: bodyText },
    };
  }

  const response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + creds.accessToken },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  const parsed = JSON.parse(response.getContentText() || '{}');
  if (code < 200 || code >= 300) {
    throw new Error((parsed.error && parsed.error.message) || 'WhatsApp API HTTP ' + code);
  }

  const waId = (parsed.messages && parsed.messages[0] && parsed.messages[0].id) || '';
  return { ok: true, mode: 'live', waMessageId: waId, to: cleanPhone, status: 'sent' };
}

/**
 * Fetches Live Meta Phone Quality + Conversation Insights (zero dummy numbers).
 */
function fetchMetaInsights_(monthStr) {
  const creds = getApiCreds_();
  if (!creds.accessToken || !creds.phoneId || !creds.wabaId) {
    throw new Error('Configure WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_ID, and WHATSAPP_WABA_ID first.');
  }

  const phoneUrl =
    'https://graph.facebook.com/' +
    creds.apiVersion +
    '/' +
    creds.phoneId +
    '?fields=display_phone_number,quality_rating,messaging_limit_tier,name_status';
  const phoneRes = UrlFetchApp.fetch(phoneUrl, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + creds.accessToken },
    muteHttpExceptions: true,
  });
  const phoneJson = JSON.parse(phoneRes.getContentText() || '{}');

  const now = new Date();
  const parts = String(monthStr || '').split('-');
  const year = Number(parts[0]) || now.getFullYear();
  const monthIdx = (Number(parts[1]) || now.getMonth() + 1) - 1;
  const startUnix = Math.floor(new Date(year, monthIdx, 1).getTime() / 1000);
  const endUnix = Math.floor(new Date(year, monthIdx + 1, 0, 23, 59, 59).getTime() / 1000);

  const analyticsUrl =
    'https://graph.facebook.com/' +
    creds.apiVersion +
    '/' +
    creds.wabaId +
    '?fields=conversation_analytics.start(' +
    startUnix +
    ').end(' +
    endUnix +
    ').granularity(DAILY).dimensions(CONVERSATION_CATEGORY)';
  const anRes = UrlFetchApp.fetch(analyticsUrl, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + creds.accessToken },
    muteHttpExceptions: true,
  });
  const anJson = JSON.parse(anRes.getContentText() || '{}');
  const dataPoints =
    (anJson.conversation_analytics &&
      anJson.conversation_analytics.data &&
      anJson.conversation_analytics.data[0] &&
      anJson.conversation_analytics.data[0].data_points) ||
    [];

  let totalConv = 0;
  let totalCost = 0;
  const breakdown = {
    marketing: { count: 0, cost: 0 },
    utility: { count: 0, cost: 0 },
    authentication: { count: 0, cost: 0 },
    service: { count: 0, cost: 0 },
  };
  const dailyMap = {};

  dataPoints.forEach(function (pt) {
    const count = Number(pt.conversation || 0);
    const cost = Number(pt.cost || 0);
    totalConv += count;
    totalCost += cost;
    const cat = String(pt.conversation_category || 'SERVICE').toLowerCase();
    if (breakdown[cat]) {
      breakdown[cat].count += count;
      breakdown[cat].cost += cost;
    }
    const dayKey = new Date(Number(pt.start || 0) * 1000).toISOString().slice(0, 10);
    if (!dailyMap[dayKey]) dailyMap[dayKey] = { date: dayKey, conversations: 0, cost: 0 };
    dailyMap[dayKey].conversations += count;
    dailyMap[dayKey].cost += cost;
  });

  return {
    fetchedAt: new Date().toISOString(),
    wabaId: creds.wabaId,
    phoneDisplay: phoneJson.display_phone_number || '',
    qualityRating: phoneJson.quality_rating || '',
    messagingTier: phoneJson.messaging_limit_tier || '',
    nameStatus: phoneJson.name_status || '',
    totalConversations: totalConv,
    totalCostInr: Math.round(totalCost * 100) / 100,
    dailyTrend: Object.keys(dailyMap)
      .sort()
      .map(function (k) {
        return dailyMap[k];
      }),
    breakdown: breakdown,
  };
}

/**
 * Fetches live Phone Number profile, quality rating & tier directly from Meta Cloud API.
 */
function fetchLivePhoneProfile_() {
  const creds = getApiCreds_();
  if (!creds.accessToken || !creds.phoneId) {
    return null;
  }
  try {
    const url =
      'https://graph.facebook.com/' +
      creds.apiVersion +
      '/' +
      creds.phoneId +
      '?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier,name_status';
    const res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + creds.accessToken },
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() >= 200 && res.getResponseCode() < 300) {
      const parsed = JSON.parse(res.getContentText() || '{}');
      return {
        displayPhoneNumber: String(parsed.display_phone_number || ''),
        verifiedName: String(parsed.verified_name || ''),
        qualityRating: String(parsed.quality_rating || ''),
        messagingTier: String(parsed.messaging_limit_tier || ''),
        nameStatus: String(parsed.name_status || ''),
      };
    }
  } catch (err) {
    Logger.log('Live Meta phone profile check failed: ' + err.message);
  }
  return null;
}

/**
 * Lists files inside the SNC Attachments Google Drive folder.
 */
function listDriveFiles_() {
  const folders = ensureDriveFolders_();
  const files = [];
  const iter = folders.attachments.getFiles();
  while (iter.hasNext() && files.length < 200) {
    const f = iter.next();
    if (f.isTrashed()) continue;
    const id = f.getId();
    files.push({
      id: id,
      name: f.getName(),
      mimeType: f.getMimeType(),
      sizeBytes: f.getSize(),
      webViewLink: f.getUrl(),
      downloadUrl: 'https://drive.usercontent.google.com/download?id=' + id + '&export=download&authuser=0',
      createdTime: f.getDateCreated() ? f.getDateCreated().toISOString() : new Date().toISOString(),
      source: 'google-drive',
    });
  }
  files.sort(function (a, b) {
    return String(b.createdTime).localeCompare(String(a.createdTime));
  });
  return files;
}

/**
 * Reads all live workspace data from Master Google Sheet + Drive + Meta Pre-Approved Templates.
 */
function buildWorkspaceBootstrap_() {
  const ss = getMasterSpreadsheet_();
  const creds = getApiCreds_();

  const contacts = [];
  const cSheet = ss.getSheetByName('Contacts');
  if (cSheet && cSheet.getLastRow() >= 2) {
    const cRows = cSheet.getRange(2, 1, cSheet.getLastRow() - 1, Math.min(14, cSheet.getLastColumn())).getValues();
    cRows.forEach(function (r, idx) {
      const phone = String(r[2] || '').replace(/\\D/g, '');
      if (!phone) return;
      contacts.push({
        id: String(r[0] || 'cnt_' + phone + '_' + idx),
        name: String(r[1] || 'Customer ' + phone.slice(-4)),
        phone: phone,
        email: String(r[3] || ''),
        company: String(r[4] || ''),
        tags: String(r[5] || '')
          .split(/[;,]/)
          .map(function (t) { return t.trim(); })
          .filter(Boolean),
        status: String(r[6] || 'open'),
        assignedAgent: String(r[7] || ''),
        custom1: String(r[8] || ''),
        custom2: String(r[9] || ''),
        attachmentUrl: String(r[10] || ''),
        attachmentName: String(r[11] || ''),
        notes: String(r[12] || ''),
        unreadCount: 0,
        lastMessagePreview: '',
        lastMessageAt: String(r[13] || new Date().toISOString()),
      });
    });
  }

  const messages = [];
  const lSheet = ss.getSheetByName('Message_Logs');
  if (lSheet && lSheet.getLastRow() >= 2) {
    const lastRow = lSheet.getLastRow();
    const startRow = Math.max(2, lastRow - 999);
    const cols = Math.min(22, Math.max(12, lSheet.getLastColumn()));
    const lRows = lSheet.getRange(startRow, 1, lastRow - startRow + 1, cols).getValues();
    lRows.forEach(function (r, idx) {
      const phone = String(r[3] || '').replace(/\\D/g, '');
      if (!phone) return;
      const attUrl = String(r[8] || '').trim();
      const attName = String(r[7] || '').trim();
      const dir = String(r[2] || 'outbound').toLowerCase() === 'inbound' ? 'inbound' : 'outbound';
      const msgTypeRaw = String(r[5] || 'text').toLowerCase();
      const attKind =
        msgTypeRaw === 'image' || msgTypeRaw === 'video' || msgTypeRaw === 'audio'
          ? msgTypeRaw
          : /\\.(png|jpe?g|webp|gif)$/i.test(attName)
            ? 'image'
            : /\\.(mp4|mov|webm|3gp)$/i.test(attName)
              ? 'video'
              : /\\.(mp3|ogg|wav|m4a|aac)$/i.test(attName)
                ? 'audio'
                : 'document';
      const tsIso = r[1] instanceof Date ? r[1].toISOString() : String(r[1] || new Date().toISOString());
      const delIso = r[15] instanceof Date ? r[15].toISOString() : String(r[15] || '');
      const readIso = r[16] instanceof Date ? r[16].toISOString() : String(r[16] || '');
      const repIso = r[17] instanceof Date ? r[17].toISOString() : String(r[17] || '');
      messages.push({
        id: String(r[0] || 'log_' + (startRow + idx)),
        contactId: 'cnt_' + phone,
        phone: phone,
        contactName: String(r[4] || 'Customer ' + phone.slice(-4)),
        direction: dir,
        type: msgTypeRaw,
        body: String(r[6] || ''),
        attachment: attUrl
          ? {
              id: 'att_' + String(r[0] || idx),
              kind: attKind,
              name: attName || 'Attachment',
              mimeType: attKind === 'image' ? 'image/jpeg' : attKind === 'video' ? 'video/mp4' : attKind === 'audio' ? 'audio/mpeg' : 'application/pdf',
              url: attUrl,
            }
          : undefined,
        status: status,
        campaignId: String(r[10] || '') || undefined,
        waMessageId: String(r[11] || '') || undefined,
        sourceSheet: String(r[12] || 'SNC Web App'),
        templateName: String(r[13] || '') || undefined,
        category: catRaw,
        timestamp: tsIso,
        deliveredAt: delIso || undefined,
        readAt: readIso || undefined,
        repliedAt: repIso || undefined,
        billable: String(r[18] || '').toLowerCase() !== 'false' && catRaw !== 'SERVICE',
        receiptNo: String(r[20] || '') || undefined,
        error: String(r[21] || '') || undefined,
      });
    });
  }

  const campaigns = [];
  const cmpSheet = ss.getSheetByName('Campaigns');
  if (cmpSheet && cmpSheet.getLastRow() >= 2) {
    const cmpRows = cmpSheet.getRange(2, 1, cmpSheet.getLastRow() - 1, Math.min(11, cmpSheet.getLastColumn())).getValues();
    cmpRows.forEach(function (r, idx) {
      if (!r[0] && !r[1]) return;
      campaigns.push({
        id: String(r[0] || 'cmp_' + idx),
        name: String(r[1] || 'Campaign ' + (idx + 1)),
        createdAt: String(r[2] || new Date().toISOString()),
        totalRecipients: Number(r[3] || 0),
        sent: Number(r[4] || 0),
        delivered: Number(r[5] || 0),
        failed: Number(r[6] || 0),
        templateName: String(r[7] || ''),
        attachmentMode: String(r[8] || 'none'),
        attachmentName: String(r[9] || '') || undefined,
        messagePreview: '',
        status: String(r[10] || 'completed'),
      });
    });
  }

  let templates = [];
  if (creds.accessToken && creds.wabaId) {
    try {
      templates = syncMetaTemplatesToSheet(false);
    } catch (tplErr) {
      Logger.log('Bootstrap live template fetch failed: ' + tplErr.message);
    }
  }
  if (templates.length === 0) {
    const tSheet = ss.getSheetByName('Templates');
    if (tSheet && tSheet.getLastRow() >= 2) {
      const tRows = tSheet.getRange(2, 1, tSheet.getLastRow() - 1, Math.min(11, tSheet.getLastColumn())).getValues();
      tRows.forEach(function (r) {
        const rawSt = String(r[9] || 'PENDING').toUpperCase();
        const normSt = rawSt === 'APPROVED' || rawSt === 'REJECTED' ? rawSt : 'PENDING';
        templates.push({
          id: 'meta-' + String(r[0] || r[1]),
          metaTemplateId: String(r[0] || ''),
          name: String(r[1] || ''),
          category: String(r[2] || 'UTILITY'),
          language: String(r[3] || 'en_US'),
          headerType: String(r[4] || 'NONE'),
          headerText: String(r[5] || '') || undefined,
          body: String(r[6] || ''),
          footer: String(r[7] || '') || undefined,
          variables: String(r[8] || '')
            .split(',')
            .map(function (v) { return v.trim(); })
            .filter(Boolean),
          status: normSt,
          source: 'meta',
          updatedAt: String(r[10] || new Date().toISOString()),
        });
      });
    }
  }

  let driveFiles = [];
  try {
    driveFiles = listDriveFiles_();
  } catch (drvErr) {
    Logger.log('Bootstrap Drive listing failed: ' + drvErr.message);
  }

  const phoneProfile = fetchLivePhoneProfile_();
  const folders = ensureDriveFolders_();

  return {
    ok: true,
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName(),
    spreadsheetUrl: ss.getUrl(),
    driveFolderId: folders.root.getId(),
    driveFolderUrl: folders.root.getUrl(),
    attachmentsFolderId: folders.attachments.getId(),
    phoneId: creds.phoneId || '',
    wabaId: creds.wabaId || '',
    contacts: contacts,
    messages: messages,
    campaigns: campaigns,
    templates: templates,
    driveFiles: driveFiles,
    phoneProfile: phoneProfile,
    syncedAt: new Date().toISOString(),
  };
}

/**
 * Syncs live templates from Meta WhatsApp Business API (APPROVED, PENDING, REJECTED).
 */
function syncMetaTemplatesToSheet(approvedOnly) {
  const creds = getApiCreds_();
  if (!creds.accessToken || !creds.wabaId) {
    throw new Error('Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_WABA_ID in Script Properties first.');
  }

  const onlyApproved = approvedOnly === true;
  const query = onlyApproved ? '?status=APPROVED&limit=250' : '?limit=250';
  const url =
    'https://graph.facebook.com/' +
    creds.apiVersion +
    '/' +
    creds.wabaId +
    '/message_templates' +
    query;
  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + creds.accessToken },
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  const parsed = JSON.parse(res.getContentText() || '{}');
  if (code < 200 || code >= 300) {
    throw new Error((parsed.error && parsed.error.message) || 'Meta Templates HTTP ' + code);
  }

  const templates = (parsed.data || [])
    .filter(function (t) {
      if (!onlyApproved) return true;
      return String(t.status || '').toUpperCase() === 'APPROVED';
    })
    .map(function (t) {
      const comps = t.components || [];
      const header = comps.find(function (c) { return c.type === 'HEADER'; }) || {};
      const body = comps.find(function (c) { return c.type === 'BODY'; }) || {};
      const footer = comps.find(function (c) { return c.type === 'FOOTER'; }) || {};
      const buttonsComp = comps.find(function (c) { return c.type === 'BUTTONS'; }) || {};
      const bodyText = String(body.text || '');
      const varMatches = bodyText.match(/\\{\\{\\s*[a-zA-Z0-9_]+\\s*\\}\\}/g) || [];
      const vars = varMatches.map(function (m) { return m.replace(/^\\{\\{\\s*|\\s*\\}\\}$/g, ''); });
      const bodyExamples =
        (body.example && Array.isArray(body.example.body_text) && Array.isArray(body.example.body_text[0]))
          ? body.example.body_text[0].map(function (v) { return String(v || ''); })
          : [];
      const headerExample =
        (header.example && Array.isArray(header.example.header_text) && header.example.header_text[0])
          ? String(header.example.header_text[0])
          : '';
      const rawStatus = String(t.status || 'PENDING').toUpperCase();
      const normStatus =
        rawStatus === 'APPROVED' || rawStatus === 'REJECTED' ? rawStatus : 'PENDING';

      return {
        id: 'meta-' + (t.id || t.name),
        metaTemplateId: String(t.id || ''),
        name: String(t.name || ''),
        category: String(t.category || 'UTILITY'),
        language: String(t.language || 'en_US'),
        headerType: header.format ? String(header.format) : 'NONE',
        headerText: header.text ? String(header.text) : undefined,
        headerExample: headerExample || undefined,
        body: bodyText,
        footer: footer.text ? String(footer.text) : undefined,
        variables: vars,
        exampleValues: bodyExamples,
        buttons: Array.isArray(buttonsComp.buttons) ? buttonsComp.buttons : [],
        status: normStatus,
        source: 'meta',
        updatedAt: new Date().toISOString(),
      };
    });

  const ss = getMasterSpreadsheet_();
  let tplSheet = ss.getSheetByName('Templates');
  if (!tplSheet) {
    setupSncSheets();
    tplSheet = ss.getSheetByName('Templates');
  }
  if (tplSheet) {
    tplSheet.clearContents();
    const rows = [
      ['template_id', 'name', 'category', 'language', 'header_type', 'header_text', 'body', 'footer', 'variables', 'status', 'updated_at'],
    ].concat(
      templates.map(function (t) {
        return [
          t.metaTemplateId || t.id, t.name, t.category, t.language, t.headerType,
          t.headerText || '', t.body, t.footer || '', t.variables.join(', '), t.status || 'PENDING', t.updatedAt,
        ];
      })
    );
    tplSheet.getRange(1, 1, rows.length, 11).setValues(rows);
  }
  return templates;
}

function createMetaTemplate_(payload) {
  const creds = getApiCreds_();
  if (!creds.accessToken || !creds.wabaId) {
    throw new Error('Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_WABA_ID in Script Properties first.');
  }
  const url =
    'https://graph.facebook.com/' + creds.apiVersion + '/' + creds.wabaId + '/message_templates';
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + creds.accessToken },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  const parsed = JSON.parse(res.getContentText() || '{}');
  if (code < 200 || code >= 300) {
    throw new Error((parsed.error && parsed.error.message) || 'Meta Template Submit HTTP ' + code);
  }
  return parsed;
}

/**
 * Syncs external receipt/template Google Sheets listed in Connected_Sheets into Message_Logs.
 */
function syncExternalSheetsNow() {
  const ss = getMasterSpreadsheet_();
  const connSheet = ss.getSheetByName('Connected_Sheets');
  const logsSheet = ss.getSheetByName('Message_Logs');
  if (!connSheet || !logsSheet || connSheet.getLastRow() < 2) {
    return { syncedCount: 0, sheetsProcessed: 0 };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const existingIds = {};
    if (logsSheet.getLastRow() >= 2) {
      const existingData = logsSheet.getRange(2, 1, logsSheet.getLastRow() - 1, 12).getValues();
      existingData.forEach(function (r) {
        if (r[0]) existingIds[String(r[0])] = true;
        if (r[11]) existingIds[String(r[11])] = true;
      });
    }

    const sources = connSheet.getDataRange().getValues();
    let syncedCount = 0;
    let sheetsProcessed = 0;

    for (let s = 1; s < sources.length; s++) {
      const row = sources[s];
      const enabled = String(row[16] || 'true').toLowerCase() !== 'false';
      const extSpreadsheetId = String(row[2] || '').trim();
      if (!enabled || !extSpreadsheetId) continue;

      const label = String(row[1] || 'External_Sheet_' + s);
      const tabName = String(row[3] || '');
      const defaultTpl = String(row[4] || '');
      const defaultCat = String(row[5] || 'UTILITY');
      const lastRowSeen = Number(row[14] || 1);

      try {
        const extSs = SpreadsheetApp.openById(extSpreadsheetId);
        const extTab = tabName ? extSs.getSheetByName(tabName) : extSs.getSheets()[0];
        if (!extTab || extTab.getLastRow() < 2) continue;

        const values = extTab.getDataRange().getValues();
        const headers = values[0].map(function (h) { return String(h || '').trim().toLowerCase(); });
        const findCol = function (spec, fallback) {
          const clean = String(spec || '').trim();
          const idx = headers.indexOf(clean.toLowerCase());
          if (idx >= 0) return idx;
          return headers.findIndex(function (h) { return h.indexOf(fallback) >= 0; });
        };

        const cPhone = findCol(row[6], 'phone');
        if (cPhone < 0) continue;
        const cName = findCol(row[7], 'name');
        const cMsg = findCol(row[8], 'message');
        const cWaId = findCol(row[9], 'wamid');
        const cStatus = findCol(row[10], 'status');
        const cTs = findCol(row[11], 'time');
        const cAtt = findCol(row[12], 'pdf');
        const cReceipt = findCol(row[13], 'receipt');

        const startIdx = Math.max(1, lastRowSeen);
        for (let r = startIdx; r < values.length; r++) {
          const item = values[r];
          const phone = String(item[cPhone] || '').replace(/\\D/g, '');
          if (phone.length < 7) continue;

          const waId = cWaId >= 0 ? String(item[cWaId] || '').trim() : '';
          const msgId = waId ? 'ext_' + waId : 'ext_' + row[0] + '_r' + (r + 1);
          if (existingIds[msgId] || (waId && existingIds[waId])) continue;

          const name = (cName >= 0 && String(item[cName] || '').trim()) || 'Customer ' + phone.slice(-4);
          const receiptNo = cReceipt >= 0 ? String(item[cReceipt] || '').trim() : '';
          const body = (cMsg >= 0 && String(item[cMsg] || '').trim()) || ('Sent ' + defaultTpl + (receiptNo ? ' · ' + receiptNo : ''));
          const attUrl = cAtt >= 0 ? normalizeDriveUrl_(item[cAtt]) : '';
          const status = (cStatus >= 0 && String(item[cStatus] || '').toLowerCase()) || 'sent';
          const tsVal = cTs >= 0 && item[cTs] ? new Date(item[cTs]).toISOString() : new Date().toISOString();

          logsSheet.appendRow([
            msgId, tsVal, 'outbound', phone, name, attUrl ? 'document' : 'template',
            body, receiptNo ? 'Receipt_' + receiptNo + '.pdf' : '', attUrl, status,
            'ext_sheet', waId, label, defaultTpl, defaultCat,
            status === 'delivered' || status === 'read' ? tsVal : '',
            status === 'read' ? tsVal : '', '', 'true', '', receiptNo, '',
          ]);
          existingIds[msgId] = true;
          if (waId) existingIds[waId] = true;
          syncedCount++;
        }

        connSheet.getRange(s + 1, 15, 1, 2).setValues([[values.length, new Date().toISOString()]]);
        sheetsProcessed++;
      } catch (sheetErr) {
        Logger.log('External sheet sync error (' + label + '): ' + sheetErr.message);
      }
    }
    return { syncedCount: syncedCount, sheetsProcessed: sheetsProcessed };
  } finally {
    lock.releaseLock();
  }
}

function installAutoSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncExternalSheetsNow') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('syncExternalSheetsNow').timeBased().everyMinutes(10).create();
  SpreadsheetApp.getUi().alert('Installed 10-minute automatic sync for Connected External Sheets.');
}

function buildRecentMessagesPayload_(sinceIso) {
  const ss = getMasterSpreadsheet_();
  const logsSheet = ss.getSheetByName('Message_Logs');
  if (!logsSheet || logsSheet.getLastRow() < 2) {
    return { ok: true, events: [], messages: [] };
  }
  const since = String(sinceIso || '').trim();
  const sinceMs = since ? new Date(since).getTime() : 0;
  const lastRow = logsSheet.getLastRow();
  const startRow = Math.max(2, lastRow - 199);
  const cols = Math.min(22, Math.max(12, logsSheet.getLastColumn()));
  const rows = logsSheet.getRange(startRow, 1, lastRow - startRow + 1, cols).getValues();
  const messages = rows
    .filter(function (r) {
      if (!sinceMs || isNaN(sinceMs)) return true;
      const tsIso = r[1] instanceof Date ? r[1].toISOString() : String(r[1] || '');
      const delIso = r[15] instanceof Date ? r[15].toISOString() : String(r[15] || '');
      const readIso = r[16] instanceof Date ? r[16].toISOString() : String(r[16] || '');
      const t1 = tsIso ? new Date(tsIso).getTime() : 0;
      const t2 = delIso ? new Date(delIso).getTime() : 0;
      const t3 = readIso ? new Date(readIso).getTime() : 0;
      return t1 > sinceMs || t2 > sinceMs || t3 > sinceMs;
    })
    .map(function (r) {
      const dir = String(r[2] || 'inbound').toLowerCase();
      const tsIso = r[1] instanceof Date ? r[1].toISOString() : String(r[1] || '');
      const delIso = r[15] instanceof Date ? r[15].toISOString() : String(r[15] || '');
      const readIso = r[16] instanceof Date ? r[16].toISOString() : String(r[16] || '');
      return {
        id: String(r[0] || ''),
        receivedAt: tsIso,
        direction: dir,
        kind: dir === 'inbound' ? 'message' : 'external_outbound',
        from: String(r[3] || ''),
        contactName: String(r[4] || 'WhatsApp User'),
        messageType: String(r[5] || 'text'),
        body: String(r[6] || ''),
        attachmentName: String(r[7] || ''),
        attachmentUrl: String(r[8] || ''),
        status: String(r[9] || (dir === 'inbound' ? 'delivered' : 'sent')),
        campaignId: String(r[10] || ''),
        waMessageId: String(r[11] || ''),
        sourceSheet: String(r[12] || 'SNC Web App'),
        templateName: String(r[13] || ''),
        category: String(r[14] || ''),
        deliveredAt: delIso,
        readAt: readIso,
        receiptNo: String(r[20] || ''),
        error: String(r[21] || ''),
      };
    });
  return { ok: true, events: messages, messages: messages };
}

function buildAuthenticatedPingPayload_() {
  const creds = getApiCreds_();
  const ss = getMasterSpreadsheet_();
  const profile = fetchLivePhoneProfile_();
  const folders = ensureDriveFolders_();
  const maskedPhone = creds.phoneId
    ? creds.phoneId.slice(0, 4) + '••••' + creds.phoneId.slice(-4)
    : '';
  return {
    ok: true,
    businessName: (profile && profile.verifiedName) || SNC_CONFIG.BUSINESS_NAME,
    displayPhoneNumber: (profile && profile.displayPhoneNumber) || '',
    qualityRating: (profile && profile.qualityRating) || '',
    messagingTier: (profile && profile.messagingTier) || '',
    phoneIdMasked: maskedPhone,
    phoneId: creds.phoneId || '',
    wabaId: creds.wabaId || '',
    spreadsheetName: ss.getName(),
    spreadsheetId: ss.getId(),
    spreadsheetUrl: ss.getUrl(),
    driveFolderId: folders.root.getId(),
    driveFolderUrl: folders.root.getUrl(),
    attachmentsFolderId: folders.attachments.getId(),
    configured: Boolean(creds.accessToken && creds.phoneId),
    wabaIdConfigured: Boolean(creds.wabaId),
    apiVersion: creds.apiVersion,
    gatewayVersion: '2.4-otp-session-locked',
    authRequired: true,
    timestamp: new Date().toISOString(),
  };
}

/**
 * GET handler: Meta Webhook verification + minimal public health check + OTP-authenticated polling.
 */
function doGet(e) {
  const params = (e && e.parameter) || {};
  const mode = String(params['hub.mode'] || '').trim();
  const token = String(params['hub.verify_token'] || '').trim();
  const challenge = String(params['hub.challenge'] || '');
  const creds = getApiCreds_();

  if (mode === 'subscribe') {
    if (token && creds.verifyToken && token === creds.verifyToken) {
      return ContentService.createTextOutput(challenge).setMimeType(ContentService.MimeType.TEXT);
    }
    return ContentService.createTextOutput('Forbidden: verify_token mismatch').setMimeType(
      ContentService.MimeType.TEXT
    );
  }

  if (params.action === 'ping' || params.action === 'health_check') {
    const maskedPhone = creds.phoneId
      ? creds.phoneId.slice(0, 4) + '••••' + creds.phoneId.slice(-4)
      : '';
    return jsonOut_({
      ok: true,
      businessName: SNC_CONFIG.BUSINESS_NAME,
      phoneIdMasked: maskedPhone,
      configured: Boolean(creds.accessToken && creds.phoneId),
      wabaIdConfigured: Boolean(creds.wabaId),
      apiVersion: creds.apiVersion,
      gatewayVersion: '2.4-otp-session-locked',
      authRequired: true,
      timestamp: new Date().toISOString(),
    });
  }

  if (!checkApiKey_(params.apiKey)) {
    return jsonOut_({ ok: false, error: 'Unauthorized: invalid workspace API key.' });
  }

  if (params.action === 'messages' || params.action === 'getMessages') {
    const sessionCheck = requireOtpSession_(params.sessionToken);
    if (!sessionCheck.ok) {
      return jsonOut_(sessionCheck);
    }
    return jsonOut_(buildRecentMessagesPayload_(params.since));
  }

  return jsonOut_({ ok: true, service: 'SNC WhatsApp Business Suite Master Gateway', authRequired: true });
}

/**
 * POST handler: Meta Webhook (with Inbound Media Download to Drive, Receipt Bot, #opt_out) & OTP-Locked Frontend API Router.
 */
function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    // A. Meta WhatsApp Business Webhook Event
    if (body.object === 'whatsapp_business_account' || Array.isArray(body.entry)) {
      handleMetaWebhookPost_(body);
      return jsonOut_({ ok: true });
    }

    // B. Optional Workspace API Key Gate
    if (!checkApiKey_(body.apiKey)) {
      return jsonOut_({ ok: false, error: 'Unauthorized: invalid workspace API key.' });
    }

    const action = String(body.action || '');

    // C. Public Auth Actions (Strict Whitelisted Admin OTP Flow)
    if (action === 'send_otp') {
      return jsonOut_(handleSendOtp_(body.phone));
    }

    if (action === 'verify_otp') {
      return jsonOut_(handleVerifyOtp_(body.phone, body.otp));
    }

    if (action === 'logout') {
      return jsonOut_(handleLogout_(body.sessionToken));
    }

    // D. External Retailer Sheet Push (authenticated via optional SNC_APP_SECRET_KEY)
    if (action === 'logExternalSend' || action === 'external_send') {
      const ss = getMasterSpreadsheet_();
      let target = ss.getSheetByName('Message_Logs');
      if (!target) {
        setupSncSheets();
        target = ss.getSheetByName('Message_Logs');
      }
      const now = body.timestamp || new Date().toISOString();
      const waId = String(body.waMessageId || '');
      const msgId = waId ? 'ext_' + waId : 'ext_' + new Date().getTime();
      target.appendRow([
        msgId, now, 'outbound', String(body.phone || '').replace(/\\D/g, ''),
        String(body.contactName || 'Customer'), body.attachmentUrl ? 'document' : 'template',
        String(body.body || ''), String(body.attachmentName || ''),
        normalizeDriveUrl_(body.attachmentUrl || ''), String(body.status || 'sent'),
        'ext_push', waId, String(body.sourceSheetName || 'SNC Currenlty Working Google Sheet 22-11-2026'),
        String(body.templateName || 'retailer_receipt'), String(body.category || 'UTILITY'),
        '', '', '', 'true', '', String(body.receiptNo || ''), '',
      ]);
      return jsonOut_({ ok: true, messageId: msgId });
    }

    // E. Layer 2 Server-Side OTP Session Enforcement for ALL Workspace Actions
    const sessionCheck = requireOtpSession_(body.sessionToken);
    if (!sessionCheck.ok) {
      return jsonOut_(sessionCheck);
    }

    if (action === 'ping' || action === 'health_check') {
      return jsonOut_(buildAuthenticatedPingPayload_());
    }

    if (action === 'getMessages' || action === 'messages') {
      return jsonOut_(buildRecentMessagesPayload_(body.since));
    }

    if (action === 'run_initial_setup' || action === 'setup_database') {
      const result = setupSncSheets();
      const folders = ensureDriveFolders_();
      return jsonOut_({ ok: true, driveFolderId: folders.root.getId(), ...result });
    }

    if (action === 'getWorkspaceBootstrap') {
      return jsonOut_(buildWorkspaceBootstrap_());
    }

    if (action === 'listDriveFiles') {
      return jsonOut_({ ok: true, files: listDriveFiles_() });
    }

    if (action === 'deleteDriveFile' && body.fileId) {
      const target = DriveApp.getFileById(String(body.fileId));
      target.setTrashed(true);
      return jsonOut_({ ok: true });
    }

    if (action === 'importExternalSheetContacts') {
      const rawRef = String(body.sheetUrlOrId || '').trim();
      const match = rawRef.match(/\\/d\\/([a-zA-Z0-9-_]+)/);
      const targetId = match ? match[1] : rawRef;
      if (!targetId) {
        return jsonOut_({ ok: false, error: 'Provide a valid Google Sheet URL or ID.' });
      }
      const extSs = SpreadsheetApp.openById(targetId);
      const sheet = extSs.getSheets()[0];
      if (!sheet || sheet.getLastRow() < 2) {
        return jsonOut_({ ok: true, contacts: [] });
      }
      const vals = sheet.getDataRange().getValues();
      const headers = vals[0].map(function (h) { return String(h || '').trim().toLowerCase(); });
      const idxPhone = headers.findIndex(function (h) { return h.indexOf('phone') >= 0 || h.indexOf('mobile') >= 0 || h.indexOf('whatsapp') >= 0; });
      if (idxPhone < 0) {
        return jsonOut_({ ok: false, error: 'Sheet must contain a Phone / Mobile / WhatsApp column.' });
      }
      const idxName = headers.findIndex(function (h) { return h.indexOf('name') >= 0; });
      const idxEmail = headers.findIndex(function (h) { return h.indexOf('email') >= 0; });
      const idxCompany = headers.findIndex(function (h) { return h.indexOf('company') >= 0 || h.indexOf('shop') >= 0 || h.indexOf('firm') >= 0; });
      const idxTags = headers.findIndex(function (h) { return h.indexOf('tag') >= 0 || h.indexOf('group') >= 0; });
      const idxCustom1 = headers.findIndex(function (h) { return h.indexOf('custom1') >= 0 || h.indexOf('order') >= 0 || h.indexOf('receipt') >= 0; });
      const idxCustom2 = headers.findIndex(function (h) { return h.indexOf('custom2') >= 0 || h.indexOf('amount') >= 0; });
      const idxAttUrl = headers.findIndex(function (h) { return h.indexOf('attachment') >= 0 || h.indexOf('pdf') >= 0 || h.indexOf('link') >= 0; });
      const imported = [];
      for (let i = 1; i < vals.length; i++) {
        const r = vals[i];
        const phone = String(r[idxPhone] || '').replace(/\\D/g, '');
        if (phone.length < 7) continue;
        imported.push({
          id: 'cnt_' + phone,
          name: (idxName >= 0 && String(r[idxName] || '').trim()) || 'Customer ' + phone.slice(-4),
          phone: phone,
          email: idxEmail >= 0 ? String(r[idxEmail] || '').trim() : '',
          company: idxCompany >= 0 ? String(r[idxCompany] || '').trim() : '',
          tags: idxTags >= 0 ? String(r[idxTags] || '').split(/[;,]/).map(function (t) { return t.trim(); }).filter(Boolean) : ['Sheet Import'],
          status: 'open',
          assignedAgent: '',
          custom1: idxCustom1 >= 0 ? String(r[idxCustom1] || '').trim() : '',
          custom2: idxCustom2 >= 0 ? String(r[idxCustom2] || '').trim() : '',
          attachmentUrl: idxAttUrl >= 0 ? normalizeDriveUrl_(r[idxAttUrl]) : '',
          attachmentName: '',
          notes: 'Imported from ' + extSs.getName(),
          unreadCount: 0,
          lastMessagePreview: '',
          lastMessageAt: new Date().toISOString(),
        });
      }
      return jsonOut_({ ok: true, contacts: imported, sheetTitle: extSs.getName() });
    }

    if (action === 'sendMessage' || action === 'send_message') {
      const res = sendWhatsAppMessage(body);
      const ss = getMasterSpreadsheet_();
      const logsSheet = ss.getSheetByName('Message_Logs');
      if (logsSheet) {
        const now = new Date().toISOString();
        logsSheet.appendRow([
          'out_' + new Date().getTime(), now, 'outbound', res.to,
          String(body.contactName || res.to), String(body.type || 'text'),
          String(body.body || ''), String(body.attachmentName || ''),
          normalizeDriveUrl_(body.attachmentUrl || ''), 'sent', String(body.campaignId || ''),
          res.waMessageId, String(body.sourceSheet || 'SNC Web App'),
          String(body.templateName || ''), String(body.category || 'UTILITY'),
          '', '', '', 'true', '', String(body.receiptNo || ''), '',
        ]);
      }
      return jsonOut_(res);
    }

    if (action === 'queue_bulk_campaign') {
      const ss = getMasterSpreadsheet_();
      let queueSheet = ss.getSheetByName('Bulk_Queue');
      if (!queueSheet) {
        setupSncSheets();
        queueSheet = ss.getSheetByName('Bulk_Queue');
      }
      const rows = Array.isArray(body.rows) ? body.rows : [];
      const campId = String(body.campaignId || 'cmp_' + new Date().getTime());
      const tpl = String(body.templateName || '');
      const toAppend = rows.map(function (r, idx) {
        return [
          'q_' + new Date().getTime() + '_' + idx,
          campId,
          String(r.phone || '').replace(/\\D/g, ''),
          String(r.name || 'Customer'),
          String(r.message || ''),
          tpl,
          normalizeDriveUrl_(r.attachmentUrl || ''),
          String(r.attachmentType || 'document'),
          String(r.attachmentName || ''),
          'PENDING',
          '',
          '',
          '',
        ];
      });
      if (toAppend.length > 0) {
        queueSheet.getRange(queueSheet.getLastRow() + 1, 1, toAppend.length, 13).setValues(toAppend);
      }
      return jsonOut_({ ok: true, queuedCount: toAppend.length, campaignId: campId });
    }

    if (action === 'syncMetaTemplates' || action === 'fetch_templates') {
      const templates = syncMetaTemplatesToSheet(body.approvedOnly === true);
      return jsonOut_({ ok: true, templates: templates });
    }

    if (action === 'createMetaTemplate' || action === 'submit_meta_template') {
      const created = createMetaTemplate_(body.templatePayload || {});
      return jsonOut_({ ok: true, data: created });
    }

    if (action === 'fetch_meta_insights') {
      const stats = fetchMetaInsights_(body.month);
      return jsonOut_({ ok: true, stats: stats });
    }

    if (action === 'save_contact' && body.contact) {
      const ss = getMasterSpreadsheet_();
      let cSheet = ss.getSheetByName('Contacts');
      if (!cSheet) {
        setupSncSheets();
        cSheet = ss.getSheetByName('Contacts');
      }
      const c = body.contact;
      const cleanPhone = String(c.phone || '').replace(/\\D/g, '');
      const values = cSheet.getDataRange().getValues();
      let foundRow = -1;
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][2] || '').replace(/\\D/g, '') === cleanPhone) {
          foundRow = i + 1;
          break;
        }
      }
      const rowValues = [
        String(c.id || 'cnt_' + cleanPhone),
        String(c.name || ''),
        cleanPhone,
        String(c.email || ''),
        String(c.company || ''),
        Array.isArray(c.tags) ? c.tags.join('; ') : String(c.tags || ''),
        String(c.status || 'open'),
        String(c.assignedAgent || 'Parag Sureshrao Chaware'),
        String(c.custom1 || ''),
        String(c.custom2 || ''),
        String(c.attachmentUrl || ''),
        String(c.attachmentName || ''),
        String(c.notes || ''),
        String(c.lastMessageAt || new Date().toISOString()),
      ];
      if (foundRow > 0) {
        cSheet.getRange(foundRow, 1, 1, 14).setValues([rowValues]);
      } else {
        cSheet.appendRow(rowValues);
      }
      return jsonOut_({ ok: true });
    }

    if (action === 'delete_contact' && body.contact) {
      const ss = getMasterSpreadsheet_();
      const cSheet = ss.getSheetByName('Contacts');
      if (cSheet && cSheet.getLastRow() >= 2) {
        const cleanPhone = String(body.contact.phone || '').replace(/\\D/g, '');
        const values = cSheet.getDataRange().getValues();
        for (let i = values.length - 1; i >= 1; i--) {
          if (String(values[i][2] || '').replace(/\\D/g, '') === cleanPhone) {
            cSheet.deleteRow(i + 1);
            break;
          }
        }
      }
      return jsonOut_({ ok: true });
    }

    if (action === 'uploadDriveAttachment') {
      const folders = ensureDriveFolders_();
      const bytes = Utilities.base64Decode(String(body.base64Data || ''));
      const rawName = String(body.fileName || 'SNC_Document.pdf');
      const rawMime = String(body.mimeType || '').trim();
      const mediaKind =
        /\\.(png|jpe?g|webp)$/i.test(rawName) || rawMime.indexOf('image/') === 0
          ? 'image'
          : /\\.(mp4|3gp)$/i.test(rawName) || rawMime.indexOf('video/') === 0
            ? 'video'
            : /\\.(mp3|ogg|aac|m4a)$/i.test(rawName) || rawMime.indexOf('audio/') === 0
              ? 'audio'
              : 'document';
      const initialBlob = Utilities.newBlob(bytes, rawMime || 'application/octet-stream', rawName);
      const resolved = resolveMediaFilenameAndMime_(initialBlob, rawName, mediaKind);
      const blob = Utilities.newBlob(bytes, resolved.mimeType, resolved.filename);
      const file = folders.attachments.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

      // Immediately pre-upload binary to Meta /{PHONE_ID}/media with exact MIME header (zero Android BIN issue)
      let metaMediaId = '';
      try {
        const creds = getApiCreds_();
        if (creds.accessToken && creds.phoneId) {
          const uploadedMeta = uploadBlobToMetaMultipart_(
            creds,
            blob,
            resolved.filename,
            mediaKind
          );
          if (uploadedMeta && uploadedMeta.ok && uploadedMeta.mediaId) {
            metaMediaId = uploadedMeta.mediaId;
          }
        }
      } catch (metaErr) {
        Logger.log('Direct Meta pre-upload skipped: ' + metaErr.message);
      }

      return jsonOut_({
        ok: true,
        file: {
          id: file.getId(),
          name: resolved.filename,
          mimeType: resolved.mimeType,
          sizeBytes: file.getSize(),
          webViewLink: file.getUrl(),
          downloadUrl:
            'https://drive.usercontent.google.com/download?id=' +
            file.getId() +
            '&export=download&authuser=0',
          createdTime: new Date().toISOString(),
          source: 'google-drive',
          metaMediaId: metaMediaId || undefined,
        },
      });
    }

    if (action === 'syncExternalSheets' || action === 'sync_external_sheets') {
      const stats = syncExternalSheetsNow();
      return jsonOut_({ ok: true, ...stats });
    }

    if (action === 'exportReportToSheet') {
      const folders = ensureDriveFolders_();
      const reportTitle = String(body.title || 'SNC WhatsApp Report ' + new Date().toISOString().slice(0, 10));
      const rows = Array.isArray(body.rows) ? body.rows : [];
      const newSs = SpreadsheetApp.create(reportTitle);
      const sheet = newSs.getSheets()[0];
      if (rows.length > 0) {
        sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
        sheet.getRange(1, 1, 1, rows[0].length)
          .setFontWeight('bold')
          .setBackground('#075E54')
          .setFontColor('#FFFFFF');
        sheet.setFrozenRows(1);
      }
      DriveApp.getFileById(newSs.getId()).moveTo(folders.root);
      return jsonOut_({ ok: true, spreadsheetUrl: newSs.getUrl(), spreadsheetId: newSs.getId() });
    }

    return jsonOut_({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonOut_({ ok: false, error: err.message });
  }
}

/**
 * Downloads inbound customer images, PDFs, videos, audio & stickers from Meta Cloud API
 * and stores them in Google Drive ATTACHMENTS_FOLDER_ID with public viewable link.
 */
function downloadMetaMediaToDrive_(mediaId, senderPhone, suggestedFilename, fallbackMime) {
  const creds = getApiCreds_();
  if (!mediaId || !creds.accessToken) return null;
  try {
    const metaUrl = 'https://graph.facebook.com/' + creds.apiVersion + '/' + mediaId;
    const metaRes = UrlFetchApp.fetch(metaUrl, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + creds.accessToken },
      muteHttpExceptions: true,
    });
    if (metaRes.getResponseCode() < 200 || metaRes.getResponseCode() >= 300) return null;
    const metaJson = JSON.parse(metaRes.getContentText() || '{}');
    if (!metaJson.url) return null;

    const binRes = UrlFetchApp.fetch(metaJson.url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + creds.accessToken },
      muteHttpExceptions: true,
    });
    if (binRes.getResponseCode() < 200 || binRes.getResponseCode() >= 300) return null;

    const mime = String(metaJson.mime_type || fallbackMime || 'application/octet-stream');
    const extMap = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'application/pdf': '.pdf',
      'video/mp4': '.mp4',
      'audio/ogg': '.ogg',
      'audio/mpeg': '.mp3',
      'audio/aac': '.aac',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    };
    const ext = extMap[mime.split(';')[0].trim()] || '';
    const stamp = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd_HHmmss');
    const safeName = suggestedFilename
      ? 'IN_' + senderPhone + '_' + stamp + '_' + suggestedFilename
      : 'IN_' + senderPhone + '_' + stamp + (ext || '.bin');

    const blob = binRes.getBlob().setName(safeName);
    const folders = ensureDriveFolders_();
    const driveFile = folders.attachments.createFile(blob);
    driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    return {
      fileId: driveFile.getId(),
      fileName: driveFile.getName(),
      mimeType: mime,
      viewUrl: 'https://drive.google.com/file/d/' + driveFile.getId() + '/view',
    };
  } catch (err) {
    Logger.log('Inbound Meta media download error (' + mediaId + '): ' + err.message);
    return null;
  }
}

/**
 * Processes Meta Webhooks: Inbound Messages + Media (Images/PDFs/Video/Audio saved to Drive),
 * Self-Service Receipt Bot, Automated #opt_out, & Status Ticks.
 */
function handleMetaWebhookPost_(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = getMasterSpreadsheet_();
    let logsSheet = ss.getSheetByName('Message_Logs');
    if (!logsSheet) {
      setupSncSheets();
      logsSheet = ss.getSheetByName('Message_Logs');
    }
    const contactsSheet = ss.getSheetByName('Contacts');
    if (!logsSheet) return;

    const entries = body.entry || [];
    entries.forEach(function (entry) {
      (entry.changes || []).forEach(function (change) {
        const value = change.value || {};
        const contacts = value.contacts || [];
        const contactName =
          (contacts[0] && contacts[0].profile && contacts[0].profile.name) || 'WhatsApp User';

        (value.messages || []).forEach(function (msg) {
          const senderPhone = String(msg.from || '').replace(/\\D/g, '');
          const msgType = String(msg.type || 'text').toLowerCase();

          // Download customer-sent media (Image, PDF/Document, Video, Audio, Sticker) to Google Drive in viewable format
          let mediaObj = null;
          let mediaSuggestedName = '';
          let mediaFallbackMime = '';
          if (msgType === 'image' && msg.image && msg.image.id) {
            mediaObj = msg.image;
            mediaFallbackMime = msg.image.mime_type || 'image/jpeg';
          } else if (msgType === 'document' && msg.document && msg.document.id) {
            mediaObj = msg.document;
            mediaSuggestedName = String(msg.document.filename || 'document.pdf');
            mediaFallbackMime = msg.document.mime_type || 'application/pdf';
          } else if (msgType === 'video' && msg.video && msg.video.id) {
            mediaObj = msg.video;
            mediaFallbackMime = msg.video.mime_type || 'video/mp4';
          } else if (msgType === 'audio' && msg.audio && msg.audio.id) {
            mediaObj = msg.audio;
            mediaFallbackMime = msg.audio.mime_type || 'audio/ogg';
          } else if (msgType === 'sticker' && msg.sticker && msg.sticker.id) {
            mediaObj = msg.sticker;
            mediaFallbackMime = msg.sticker.mime_type || 'image/webp';
          }

          let savedMedia = null;
          if (mediaObj && mediaObj.id) {
            savedMedia = downloadMetaMediaToDrive_(
              mediaObj.id,
              senderPhone,
              mediaSuggestedName,
              mediaFallbackMime
            );
          }

          const attName = (savedMedia && savedMedia.fileName) || mediaSuggestedName || '';
          const attViewUrl = (savedMedia && savedMedia.viewUrl) || '';

          const textBody =
            (msg.text && msg.text.body) ||
            (msg.image && msg.image.caption) ||
            (msg.video && msg.video.caption) ||
            (msg.document && msg.document.caption) ||
            (msg.button && msg.button.text) ||
            (msg.interactive && msg.interactive.button_reply && msg.interactive.button_reply.title) ||
            (msg.interactive && msg.interactive.list_reply && msg.interactive.list_reply.title) ||
            (attName ? '[' + msgType.toUpperCase() + '] ' + attName : '[' + msgType + ' message]');
          const now = new Date().toISOString();

          logsSheet.appendRow([
            'in_' + (msg.id || new Date().getTime()), now, 'inbound',
            senderPhone, contactName, msgType === 'sticker' ? 'image' : msgType, textBody,
            attName, attViewUrl, 'delivered',
            '', msg.id || '', 'WhatsApp Inbound', '', 'SERVICE', now, '', now, 'false', '0', '', '',
          ]);

          // Upsert inbound customer into Contacts tab automatically so live CRM stays synchronized
          if (contactsSheet && senderPhone) {
            let existsRow = -1;
            if (contactsSheet.getLastRow() >= 2) {
              const existingPhones = contactsSheet.getRange(2, 3, contactsSheet.getLastRow() - 1, 1).getValues();
              for (let p = 0; p < existingPhones.length; p++) {
                if (String(existingPhones[p][0] || '').replace(/\\D/g, '') === senderPhone) {
                  existsRow = p + 2;
                  break;
                }
              }
            }
            if (existsRow > 0) {
              contactsSheet.getRange(existsRow, 14).setValue(now);
            } else {
              contactsSheet.appendRow([
                'cnt_' + senderPhone, contactName, senderPhone, '', '', 'Inbound',
                'open', 'Parag Sureshrao Chaware', '', '', '', '', 'Auto-created from WhatsApp webhook', now,
              ]);
            }
          }

          const lower = textBody.trim().toLowerCase();

          // 1. Automated Opt-Out Compliance Engine (STOP / UNSUBSCRIBE)
          if (lower === 'stop' || lower === 'unsubscribe') {
            if (contactsSheet && contactsSheet.getLastRow() >= 2) {
              const cVals = contactsSheet.getDataRange().getValues();
              for (let r = 1; r < cVals.length; r++) {
                if (String(cVals[r][2] || '').replace(/\\D/g, '') === senderPhone) {
                  const prevTags = String(cVals[r][5] || '');
                  if (prevTags.indexOf('#opt_out') === -1) {
                    contactsSheet.getRange(r + 1, 6).setValue(prevTags ? prevTags + '; #opt_out' : '#opt_out');
                  }
                  break;
                }
              }
            }
            try {
              sendWhatsAppMessage({
                to: senderPhone,
                type: 'text',
                body: 'You have been unsubscribed from automated SNC promotional broadcasts (#opt_out). Reply START anytime to re-subscribe.',
              });
            } catch (optErr) {
              Logger.log('Opt-out confirmation error: ' + optErr.message);
            }
            return;
          }

          // 2. Self-Service Receipt Bot ("Bill" / "Receipt" / "खाते" / "पावती")
          if (
            lower.indexOf('bill') >= 0 ||
            lower.indexOf('receipt') >= 0 ||
            textBody.indexOf('खाते') >= 0 ||
            textBody.indexOf('पावती') >= 0
          ) {
            const logRows = logsSheet.getDataRange().getValues();
            let latestPdfUrl = '';
            let latestPdfName = 'SNC_Receipt.pdf';
            for (let j = logRows.length - 1; j >= 1; j--) {
              const rowPhone = String(logRows[j][3] || '').replace(/\\D/g, '');
              const rowUrl = String(logRows[j][8] || '').trim();
              if (rowPhone === senderPhone && rowUrl.indexOf('https://') === 0) {
                latestPdfUrl = normalizeDriveUrl_(rowUrl);
                latestPdfName = String(logRows[j][7] || 'SNC_Receipt.pdf');
                break;
              }
            }
            try {
              if (latestPdfUrl) {
                sendWhatsAppMessage({
                  to: senderPhone,
                  type: 'document',
                  attachmentUrl: latestPdfUrl,
                  attachmentName: latestPdfName,
                  body: 'Namaste ' + contactName + ', here is your latest SNC receipt PDF.',
                });
              } else {
                sendWhatsAppMessage({
                  to: senderPhone,
                  type: 'text',
                  body: 'Namaste ' + contactName + ', our accounts team has received your receipt request and will share your statement shortly.',
                });
              }
            } catch (botErr) {
              Logger.log('Receipt bot error: ' + botErr.message);
            }
          }
        });

        // 3. Delivery, Read, Failed & Pricing Status Webhooks
        const statuses = value.statuses || [];
        if (statuses.length > 0 && logsSheet.getLastRow() >= 2) {
          const lastRow = logsSheet.getLastRow();
          const startRow = Math.max(2, lastRow - 499);
          const waIdRange = logsSheet.getRange(startRow, 12, lastRow - startRow + 1, 1).getValues();
          const rowByWaId = {};
          for (let i = 0; i < waIdRange.length; i++) {
            const idStr = String(waIdRange[i][0] || '').trim();
            if (idStr) rowByWaId[idStr] = startRow + i;
          }

          statuses.forEach(function (st) {
            const targetRow = rowByWaId[String(st.id || '').trim()];
            if (!targetRow) return;
            const statusVal = String(st.status || '').toLowerCase();
            const now = new Date().toISOString();
            const currentStatus = String(logsSheet.getRange(targetRow, 10).getValue() || '').toLowerCase();
            const rank = { queued: 0, failed: 1, sent: 2, delivered: 3, read: 4 };
            if ((rank[statusVal] || 0) >= (rank[currentStatus] || 0)) {
              logsSheet.getRange(targetRow, 10).setValue(statusVal);
            }
            if (statusVal === 'delivered') logsSheet.getRange(targetRow, 16).setValue(now);
            if (statusVal === 'read') logsSheet.getRange(targetRow, 17).setValue(now);
            if (st.pricing && st.pricing.category) {
              logsSheet.getRange(targetRow, 15).setValue(String(st.pricing.category).toUpperCase());
              logsSheet.getRange(targetRow, 19).setValue(st.pricing.billable === false ? 'false' : 'true');
            }
            if (statusVal === 'failed' && st.errors && st.errors[0]) {
              logsSheet.getRange(targetRow, 22).setValue(
                String(st.errors[0].title || st.errors[0].message || 'Failed')
              );
            }
          });
        }
      });
    });
  } finally {
    lock.releaseLock();
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function getMasterSpreadsheet_() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  const ssId = String(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '').trim();
  if (ssId) return SpreadsheetApp.openById(ssId);
  throw new Error('Set SPREADSHEET_ID in Apps Script Project Settings -> Script Properties.');
}
`;
}

/**
 * Generates Worker_Code.gs — the Dedicated Background Bulk Dispatch, 85% Quota Guardrail,
 * 30,000-Row Auto-Sharding, and 14-Day Nightly Backup Worker (Zero Hardcoded IDs/Secrets).
 */
export function generateWorkerAppsScriptCode(options: AppsScriptGeneratorOptions = {}): string {
  const folderId = (options.folderId || '').trim();
  const businessName = (
    options.businessName?.trim() || 'SNC WhatsApp Business'
  ).replace(/'/g, "\\'");

  return `/**
 * ============================================================================
 * ${businessName} — Worker_Code.gs (Background Queue, Sharding & Backup Engine)
 * ============================================================================
 * Reads SPREADSHEET_ID and DRIVE_FOLDER_ID strictly from Apps Script Script Properties.
 *
 * Triggers to install (run installWorkerTriggers() once):
 *   1. processBulkQueueBatch  -> Every 1 minute (bypasses Google 6-min execution limit)
 *   2. checkAndRotateShard    -> Daily at 02:00 AM (shards Message_Logs > 30,000 rows)
 *   3. nightlyWorkspaceBackup -> Daily at 03:00 AM (14-day rolling Drive backup)
 */

const WORKER_CONFIG = {
  DEFAULT_DRIVE_FOLDER_ID: '${folderId}',
  BATCH_SIZE_PER_MINUTE: 25,
  THROTTLE_MS: 1200,
  DAILY_TIER_LIMIT: 1000,
  QUOTA_GUARDRAIL_RATIO: 0.85,
  SHARD_THRESHOLD_ROWS: 30000,
  SHARD_ARCHIVE_BATCH: 25000,
  BACKUP_RETENTION_DAYS: 14,
};

function getWorkerSpreadsheet_() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  const ssId = String(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '').trim();
  if (ssId) return SpreadsheetApp.openById(ssId);
  throw new Error('Set SPREADSHEET_ID in Script Properties.');
}

function getWorkerRootFolder_() {
  const props = PropertiesService.getScriptProperties();
  const folderId = String(
    props.getProperty('DRIVE_FOLDER_ID') ||
      WORKER_CONFIG.DEFAULT_DRIVE_FOLDER_ID ||
      ''
  ).trim();
  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (e) {
      // Fall through to parent folder auto-detection
    }
  }
  const ss = getWorkerSpreadsheet_();
  const parents = DriveApp.getFileById(ss.getId()).getParents();
  if (parents.hasNext()) {
    const parent = parents.next();
    props.setProperty('DRIVE_FOLDER_ID', parent.getId());
    return parent;
  }
  const found = DriveApp.getFoldersByName('SNC Whats App');
  const created = found.hasNext() ? found.next() : DriveApp.createFolder('SNC Whats App');
  props.setProperty('DRIVE_FOLDER_ID', created.getId());
  return created;
}

function installWorkerTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const fn = t.getHandlerFunction();
    if (
      fn === 'processBulkQueueBatch' ||
      fn === 'checkAndRotateShard' ||
      fn === 'nightlyWorkspaceBackup'
    ) {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('processBulkQueueBatch').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('checkAndRotateShard').timeBased().atHour(2).everyDays(1).create();
  ScriptApp.newTrigger('nightlyWorkspaceBackup').timeBased().atHour(3).everyDays(1).create();
  Logger.log('Installed all 3 SNC Worker triggers successfully.');
}

/**
 * 1-Minute Chunked Bulk Dispatch Worker with 85% Meta API Quota Guardrail & #opt_out filter.
 */
function processBulkQueueBatch() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;

  try {
    const props = PropertiesService.getScriptProperties();
    const todayKey = 'DAILY_SEND_COUNT_' + new Date().toISOString().slice(0, 10);
    let dailySent = Number(props.getProperty(todayKey) || 0);
    const maxSafeDaily = Math.floor(
      WORKER_CONFIG.DAILY_TIER_LIMIT * WORKER_CONFIG.QUOTA_GUARDRAIL_RATIO
    );
    if (dailySent >= maxSafeDaily) {
      Logger.log('85% Daily Quota Guardrail reached (' + dailySent + '/' + maxSafeDaily + '). Pausing until tomorrow.');
      return;
    }

    const ss = getWorkerSpreadsheet_();
    const queueSheet = ss.getSheetByName('Bulk_Queue');
    const logsSheet = ss.getSheetByName('Message_Logs');
    const contactsSheet = ss.getSheetByName('Contacts');
    if (!queueSheet || !logsSheet || queueSheet.getLastRow() < 2) return;

    // Build #opt_out phone set
    const optedOut = {};
    if (contactsSheet && contactsSheet.getLastRow() >= 2) {
      const cRows = contactsSheet.getDataRange().getValues();
      for (let c = 1; c < cRows.length; c++) {
        if (String(cRows[c][5] || '').indexOf('#opt_out') >= 0) {
          optedOut[String(cRows[c][2] || '').replace(/\\D/g, '')] = true;
        }
      }
    }

    const values = queueSheet.getDataRange().getValues();
    let processed = 0;

    for (let i = 1; i < values.length; i++) {
      if (processed >= WORKER_CONFIG.BATCH_SIZE_PER_MINUTE) break;
      if (dailySent >= maxSafeDaily) break;

      const row = values[i];
      if (String(row[9] || '').toUpperCase() !== 'PENDING') continue;

      const campaignId = String(row[1] || 'worker_bulk');
      const phone = String(row[2] || '').replace(/\\D/g, '');
      const name = String(row[3] || 'Customer');
      const message = String(row[4] || '');
      const templateName = String(row[5] || '');
      const attUrl = String(row[6] || '');
      const attType = String(row[7] || 'document').toLowerCase();
      const attName = String(row[8] || '');
      const now = new Date().toISOString();

      if (optedOut[phone]) {
        queueSheet.getRange(i + 1, 10, 1, 4).setValues([['SKIPPED_OPT_OUT', '', now, 'Contact has #opt_out tag']]);
        continue;
      }

      try {
        const res = sendWhatsAppMessage({
          to: phone,
          type: templateName ? 'template' : attUrl ? attType : 'text',
          body: message,
          templateName: templateName || undefined,
          attachmentUrl: attUrl || undefined,
          attachmentName: attName || undefined,
        });
        queueSheet.getRange(i + 1, 10, 1, 4).setValues([['SENT', res.waMessageId, now, '']]);
        logsSheet.appendRow([
          'wrk_' + new Date().getTime() + '_' + i, now, 'outbound', phone, name,
          templateName ? 'template' : attUrl ? attType : 'text', message, attName, attUrl,
          'sent', campaignId, res.waMessageId, 'Worker_Bulk_Queue', templateName, 'UTILITY',
          '', '', '', 'true', '', '', '',
        ]);
        dailySent++;
        processed++;
        props.setProperty(todayKey, String(dailySent));
      } catch (err) {
        queueSheet.getRange(i + 1, 10, 1, 4).setValues([['FAILED', '', now, String(err.message || err)]]);
        processed++;
      }

      Utilities.sleep(WORKER_CONFIG.THROTTLE_MS);
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * Auto-Sharding Engine: archives oldest 25,000 rows once Message_Logs exceeds 30,000 rows.
 */
function checkAndRotateShard() {
  const ss = getWorkerSpreadsheet_();
  const logsSheet = ss.getSheetByName('Message_Logs');
  const registrySheet = ss.getSheetByName('Shards_Registry');
  if (!logsSheet || !registrySheet) return;

  const totalRows = logsSheet.getLastRow() - 1;
  if (totalRows <= WORKER_CONFIG.SHARD_THRESHOLD_ROWS) return;

  const root = getWorkerRootFolder_();
  const shardsIter = root.getFoldersByName('Message_Shards');
  const shardsFolder = shardsIter.hasNext() ? shardsIter.next() : root.createFolder('Message_Shards');

  const archiveCount = Math.min(WORKER_CONFIG.SHARD_ARCHIVE_BATCH, totalRows - 1000);
  const cols = logsSheet.getLastColumn();
  const headers = logsSheet.getRange(1, 1, 1, cols).getValues();
  const archiveData = logsSheet.getRange(2, 1, archiveCount, cols).getValues();

  const firstDate = String(archiveData[0][1] || '').slice(0, 10);
  const lastDate = String(archiveData[archiveData.length - 1][1] || '').slice(0, 10);
  const shardId = 'SNC_Shard_' + new Date().toISOString().slice(0, 10) + '_' + new Date().getTime();

  const shardSs = SpreadsheetApp.create(shardId);
  const shardTab = shardSs.getSheets()[0];
  shardTab.setName('Message_Logs_Archive');
  shardTab.getRange(1, 1, 1, cols).setValues(headers);
  shardTab.getRange(2, 1, archiveCount, cols).setValues(archiveData);
  DriveApp.getFileById(shardSs.getId()).moveTo(shardsFolder);

  logsSheet.deleteRows(2, archiveCount);
  registrySheet.appendRow([
    shardId,
    shardSs.getId(),
    shardSs.getUrl(),
    archiveCount,
    new Date().toISOString(),
    firstDate + ' to ' + lastDate,
  ]);
}

/**
 * Nightly Automated Backup with 14-day rolling retention in Google Drive.
 */
function nightlyWorkspaceBackup() {
  const ss = getWorkerSpreadsheet_();
  const root = getWorkerRootFolder_();
  const bIter = root.getFoldersByName('Nightly_Backups');
  const backupFolder = bIter.hasNext() ? bIter.next() : root.createFolder('Nightly_Backups');

  const masterFile = DriveApp.getFileById(ss.getId());
  const stamp = new Date().toISOString().slice(0, 10);
  masterFile.makeCopy('SNC_Master_Backup_' + stamp, backupFolder);

  const cutoffMs = Date.now() - WORKER_CONFIG.BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const files = backupFolder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    if (f.getDateCreated().getTime() < cutoffMs) {
      f.setTrashed(true);
    }
  }
}
`;
}

/**
 * Generates the External Retailer Receipt Sheet Drop-In Script
 * with zero hardcoded secrets (reads WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_ID, MASTER_GATEWAY_URL from ScriptProperties).
 */
export function generateRetailerSheetDropInScript(options: {
  masterWebAppUrl?: string;
  phoneId?: string;
  apiVersion?: string;
} = {}): string {
  const apiVersion = options.apiVersion?.trim() || 'v25.0';

  return `/**
 * ============================================================================
 * External Retailer Receipt Sheet — Drop-In WhatsApp Automation Script
 * ============================================================================
 * Zero Hardcoded Secrets: Store WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_ID,
 * and MASTER_GATEWAY_URL inside Project Settings -> Script Properties.
 */

const RETAILER_SHEET_CONFIG = {
  TAB_NAME: 'Receipt',
  TEMPLATE_NAME: 'retailer_receipt',
  API_VERSION: '${apiVersion}',
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Retailer Tools')
    .addItem('1. Configure Script Properties', 'configureRetailerToken')
    .addItem('2. Send Pending WhatsApps', 'processBulkWhatsApp')
    .addToUi();
}

function configureRetailerToken() {
  const ui = SpreadsheetApp.getUi();
  const tokenRes = ui.prompt('Meta WhatsApp Access Token', 'Paste your Meta Access Token:', ui.ButtonSet.OK_CANCEL);
  if (tokenRes.getSelectedButton() !== ui.Button.OK) return;
  const phoneRes = ui.prompt('Meta Phone Number ID', 'Enter your Meta Phone Number ID:', ui.ButtonSet.OK_CANCEL);
  if (phoneRes.getSelectedButton() !== ui.Button.OK) return;
  const gwRes = ui.prompt('Master Gateway /exec URL', 'Paste your deployed Gateway_Code.gs /exec URL:', ui.ButtonSet.OK_CANCEL);
  if (gwRes.getSelectedButton() !== ui.Button.OK) return;

  PropertiesService.getScriptProperties().setProperties({
    WHATSAPP_ACCESS_TOKEN: tokenRes.getResponseText().trim(),
    WHATSAPP_PHONE_ID: phoneRes.getResponseText().trim(),
    MASTER_GATEWAY_URL: gwRes.getResponseText().trim(),
  });
  ui.alert('Saved securely to Script Properties.');
}

function toDirectDriveDownloadUrl_(url) {
  const clean = String(url || '').trim();
  const match = clean.match(/drive\\.google\\.com\\/file\\/d\\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return 'https://drive.usercontent.google.com/download?id=' + match[1] + '&export=download&authuser=0';
  }
  return clean;
}

function processBulkWhatsApp() {
  const props = PropertiesService.getScriptProperties();
  const token = String(props.getProperty('WHATSAPP_ACCESS_TOKEN') || '').trim();
  const phoneId = String(props.getProperty('WHATSAPP_PHONE_ID') || '').trim();
  const masterGatewayUrl = String(props.getProperty('MASTER_GATEWAY_URL') || '').trim();
  if (!token || !phoneId) {
    SpreadsheetApp.getUi().alert('Run "Retailer Tools -> 1. Configure Script Properties" first to save WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_ID, and MASTER_GATEWAY_URL.');
    return;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(RETAILER_SHEET_CONFIG.TAB_NAME);
  if (!sheet) throw new Error('Tab "' + RETAILER_SHEET_CONFIG.TAB_NAME + '" not found.');

  const data = sheet.getDataRange().getValues();
  let sentCount = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const receiptNo = String(row[0] || '').trim();
    const retailerName = String(row[1] || '').trim();
    const rawPhone = String(row[2] || '').replace(/\\D/g, '');
    const pdfDriveUrl = String(row[3] || '').trim();
    const status = String(row[4] || '').trim().toUpperCase();

    if (!rawPhone || status === 'SENT') continue;
    const phone = rawPhone.length === 10 ? '91' + rawPhone : rawPhone;
    const directPdfUrl = toDirectDriveDownloadUrl_(pdfDriveUrl);

    try {
      const waId = sendRetailerReceiptMessage_(token, phoneId, phone, retailerName, receiptNo, directPdfUrl);
      sheet.getRange(i + 1, 5).setValue('SENT');
      sheet.getRange(i + 1, 6).setValue(waId);
      sheet.getRange(i + 1, 7).setValue(new Date().toISOString());

      // Push live delivery log to SNC Master Gateway when MASTER_GATEWAY_URL is set
      if (masterGatewayUrl) {
        UrlFetchApp.fetch(masterGatewayUrl, {
          method: 'post',
          contentType: 'text/plain;charset=utf-8',
          payload: JSON.stringify({
            action: 'logExternalSend',
            sourceSheetName: ss.getName(),
            phone: phone,
            contactName: retailerName,
            templateName: RETAILER_SHEET_CONFIG.TEMPLATE_NAME,
            category: 'UTILITY',
            receiptNo: receiptNo,
            attachmentName: 'Receipt_' + receiptNo + '.pdf',
            attachmentUrl: pdfDriveUrl || directPdfUrl,
            waMessageId: waId,
            status: 'sent',
            body: 'Retailer Receipt ' + receiptNo + ' dispatched via Google Sheet automation.',
            timestamp: new Date().toISOString(),
          }),
          muteHttpExceptions: true,
        });
      }

      sentCount++;
      Utilities.sleep(1000);
    } catch (err) {
      sheet.getRange(i + 1, 5).setValue('FAILED: ' + err.message);
    }
  }

  SpreadsheetApp.getUi().alert('Completed! Dispatched ' + sentCount + ' pending WhatsApp receipts.');
}

function uploadReceiptPdfToMeta_(token, phoneId, pdfUrl, filename) {
  try {
    const clean = String(pdfUrl || '').trim();
    const idMatch =
      clean.match(/drive\\.google\\.com\\/file\\/d\\/([a-zA-Z0-9_-]+)/) ||
      clean.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    const blob =
      idMatch && idMatch[1]
        ? DriveApp.getFileById(idMatch[1]).getBlob()
        : UrlFetchApp.fetch(clean, { muteHttpExceptions: true }).getBlob();
    const safeName = String(filename || 'SNC_Receipt.pdf').replace(/[\\r\\n"]/g, '_');
    const boundary = 'SncReceiptBoundary_' + Utilities.getUuid().replace(/-/g, '');
    const crlf = '\\r\\n';
    let head = '';
    head += '--' + boundary + crlf;
    head += 'Content-Disposition: form-data; name="messaging_product"' + crlf + crlf;
    head += 'whatsapp' + crlf;
    head += '--' + boundary + crlf;
    head += 'Content-Disposition: form-data; name="type"' + crlf + crlf;
    head += 'application/pdf' + crlf;
    head += '--' + boundary + crlf;
    head += 'Content-Disposition: form-data; name="file"; filename="' + safeName + '"' + crlf;
    head += 'Content-Type: application/pdf' + crlf + crlf;
    const tail = crlf + '--' + boundary + '--' + crlf;
    const payloadBytes = Utilities.newBlob(head)
      .getBytes()
      .concat(blob.getBytes())
      .concat(Utilities.newBlob(tail).getBytes());

    const uploadRes = UrlFetchApp.fetch(
      'https://graph.facebook.com/' + RETAILER_SHEET_CONFIG.API_VERSION + '/' + phoneId + '/media',
      {
        method: 'post',
        contentType: 'multipart/form-data; boundary=' + boundary,
        headers: { Authorization: 'Bearer ' + token },
        payload: payloadBytes,
        muteHttpExceptions: true,
      }
    );
    const parsed = JSON.parse(uploadRes.getContentText() || '{}');
    if (uploadRes.getResponseCode() >= 200 && uploadRes.getResponseCode() < 300 && parsed.id) {
      return String(parsed.id);
    }
    Logger.log('Receipt PDF /media upload failed: ' + uploadRes.getContentText());
  } catch (err) {
    Logger.log('Receipt PDF /media upload error: ' + err.message);
  }
  return '';
}

function sendRetailerReceiptMessage_(token, phoneId, phone, retailerName, receiptNo, directPdfUrl) {
  const endpoint =
    'https://graph.facebook.com/' +
    RETAILER_SHEET_CONFIG.API_VERSION +
    '/' +
    phoneId +
    '/messages';

  const safeFilename = 'Receipt_' + receiptNo + '.pdf';
  const uploadedMediaId = uploadReceiptPdfToMeta_(token, phoneId, directPdfUrl, safeFilename);
  const documentParam = uploadedMediaId
    ? { id: uploadedMediaId, filename: safeFilename }
    : { link: directPdfUrl, filename: safeFilename };

  const payload = {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'template',
    template: {
      name: RETAILER_SHEET_CONFIG.TEMPLATE_NAME,
      language: { code: 'en_US' },
      components: [
        {
          type: 'header',
          parameters: [
            {
              type: 'document',
              document: documentParam,
            },
          ],
        },
        {
          type: 'body',
          parameters: [
            { type: 'text', text: retailerName },
            { type: 'text', text: receiptNo },
          ],
        },
      ],
    },
  };

  const res = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const parsed = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
    throw new Error((parsed.error && parsed.error.message) || 'Meta HTTP ' + res.getResponseCode());
  }
  return (parsed.messages && parsed.messages[0] && parsed.messages[0].id) || '';
}
`;
}

// Backward-compatible alias for existing callers & unit tests
export const generateAppsScriptCode = generateGatewayAppsScriptCode;

/**
 * Generates a lightweight helper snippet for pushing outbound sends from any external Google Sheet
 * directly into SNC WhatsApp Master Gateway.
 */
export function generateExternalSheetPushSnippet(options: {
  masterWebAppUrl?: string;
  apiKey?: string;
  sourceSheetName?: string;
  defaultTemplate?: string;
  defaultCategory?: string;
}): string {
  const url = (
    options.masterWebAppUrl ||
    'PASTE_YOUR_DEPLOYED_GATEWAY_EXEC_URL_HERE'
  ).trim();
  const apiKey = (options.apiKey || '').trim();
  const sourceName = (
    options.sourceSheetName || 'SNC Currenlty Working Google Sheet 22-11-2026'
  ).replace(/'/g, "\\'");
  const tpl = (options.defaultTemplate || 'retailer_receipt').replace(/'/g, "\\'");
  const cat = (options.defaultCategory || 'UTILITY').replace(/'/g, "\\'");

  return `/**
 * Drop this helper into any external receipt/template Google Sheet Apps Script.
 * Call logToSncDashboard_(...) right after Meta Cloud API returns messages[0].id.
 */
function logToSncDashboard_(entry) {
  const MASTER_WEBAPP_URL = '${url}';
  const payload = {
    action: 'logExternalSend',
    apiKey: '${apiKey}',
    sourceSheetName: entry.sourceSheetName || '${sourceName}',
    phone: String(entry.phone || ''),
    contactName: String(entry.contactName || ''),
    templateName: String(entry.templateName || '${tpl}'),
    category: String(entry.category || '${cat}'),
    body: String(entry.body || ''),
    receiptNo: String(entry.receiptNo || ''),
    attachmentName: String(entry.attachmentName || ''),
    attachmentUrl: String(entry.attachmentUrl || ''),
    waMessageId: String(entry.waMessageId || ''),
    status: String(entry.status || 'sent'),
    timestamp: new Date().toISOString(),
  };

  UrlFetchApp.fetch(MASTER_WEBAPP_URL, {
    method: 'post',
    contentType: 'text/plain;charset=utf-8',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
}`;
}
