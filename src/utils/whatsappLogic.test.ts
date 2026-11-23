import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBulkRecipients,
  contactsToCsv,
  contactsToSheetRows,
  dedupeMessages,
  extractTemplateVariables,
  formatPhoneDisplay,
  inferAttachmentKind,
  isSafeHttpsUrl,
  isValidPhone,
  normalizePhone,
  parseCsvContacts,
  renderMessageTemplate,
  resolveRecipientAttachment,
  sheetRowsToContacts,
} from './whatsappLogic';
import {
  DEFAULT_PRICING_RATES,
  buildCustomReportCsv,
  buildCustomReportExcelXml,
  buildMetaTemplatePayload,
  computeDashboardAnalytics,
  filterReportMessages,
  mapCustomRowsToContacts,
  parseExternalSheetMessages,
  parseRawTableForMapping,
  validateMetaTemplateInput,
} from './analyticsLogic';
import {
  generateAppsScriptCode,
  generateExternalSheetPushSnippet,
} from './appsScriptTemplate';
import type { ChatMessage, Contact, ExternalSheetSource } from '../types';

test('normalizePhone and isValidPhone handle Indian, US, and international formats', () => {
  assert.equal(normalizePhone('98765 43210', '91'), '919876543210');
  assert.equal(normalizePhone('+91-98765-43210', '91'), '919876543210');
  assert.equal(normalizePhone('09876543210', '91'), '919876543210');
  assert.equal(normalizePhone('+1 (415) 555-0192', '91'), '14155550192');
  assert.equal(isValidPhone('919876543210'), true);
  assert.equal(isValidPhone('12345'), false);
  assert.equal(isValidPhone('0123456789'), false);
  assert.equal(formatPhoneDisplay('919876543210'), '+91 98765 43210');
});

test('renderMessageTemplate interpolates named and positional placeholders cleanly', () => {
  const contact: Partial<Contact> = {
    name: 'Priya Sharma',
    phone: '919820112233',
    company: 'Apex Textiles',
    custom1: 'ORD-4821',
    custom2: 'Mumbai',
  };

  const rendered = renderMessageTemplate(
    'Hello {{first_name}} ({{name}}) from {{company}}, order {{custom1}} ships to {{custom2}}.',
    contact
  );
  assert.equal(
    rendered,
    'Hello Priya (Priya Sharma) from Apex Textiles, order ORD-4821 ships to Mumbai.'
  );

  const positional = renderMessageTemplate('Hi {{1}}, ref {{2}} in {{3}}.', contact);
  assert.equal(positional, 'Hi Priya Sharma, ref ORD-4821 in Mumbai.');
  assert.deepEqual(extractTemplateVariables('Hi {{name}}, order {{custom1}} and {{name}}'), [
    'name',
    'custom1',
  ]);
});

test('parseCsvContacts parses quoted fields, deduplicates numbers, and validates https attachment URLs', () => {
  const csv = [
    'Name,WhatsApp,Company,Tags,Custom1,Attachment_URL',
    '"Meera Joshi",9820445566,"Nova Retail, Inc.",VIP;Wholesale,INV-101,https://drive.google.com/uc?id=abc',
    'Duplicate Row,+91 98204 45566,Nova,VIP,INV-102,https://example.com/a.pdf',
    'Bad Phone,123,BadCo,Test,INV-103,javascript:alert(1)',
    'Unsafe Att,9820778899,SafeCo,Lead,INV-104,javascript:alert(1)',
  ].join('\n');

  const result = parseCsvContacts(csv, '91', '2026-11-22T10:00:00.000Z');
  assert.equal(result.contacts.length, 2);
  assert.equal(result.skippedRows, 2);
  assert.equal(result.contacts[0].company, 'Nova Retail, Inc.');
  assert.deepEqual(result.contacts[0].tags, ['VIP', 'Wholesale']);
  assert.equal(result.contacts[0].attachmentUrl, 'https://drive.google.com/uc?id=abc');
  assert.equal(result.contacts[1].attachmentUrl, '');
});

test('contactsToSheetRows and sheetRowsToContacts round-trip cleanly', () => {
  const sample: Contact[] = [
    {
      id: 'c1',
      name: 'Arjun Mehta',
      phone: '919811223344',
      email: 'arjun@swiftlog.in',
      company: 'SwiftLog Freight',
      tags: ['Enterprise', 'Active'],
      status: 'open',
      assignedAgent: 'Sanket Rathod',
      custom1: 'SHP-909',
      custom2: 'Pune',
      attachmentUrl: 'https://drive.google.com/file/d/123/view',
      attachmentName: 'invoice_909.pdf',
      notes: 'Prefers PDF invoices',
      unreadCount: 2,
      lastMessagePreview: 'Thanks!',
      lastMessageAt: '2026-11-22T09:00:00.000Z',
    },
  ];

  const rows = contactsToSheetRows(sample);
  const restored = sheetRowsToContacts(rows, '91');
  assert.equal(restored.length, 1);
  assert.equal(restored[0].name, 'Arjun Mehta');
  assert.equal(restored[0].phone, '919811223344');
  assert.deepEqual(restored[0].tags, ['Enterprise', 'Active']);
  assert.equal(restored[0].attachmentName, 'invoice_909.pdf');

  const csvOut = contactsToCsv(sample);
  assert.ok(csvOut.includes('Arjun Mehta'));
  assert.ok(csvOut.includes('invoice_909.pdf'));
});

test('buildBulkRecipients deduplicates selected contacts and manual numbers while flagging invalids', () => {
  const contact: Contact = {
    id: 'c1',
    name: 'Priya',
    phone: '919820112233',
    email: '',
    company: 'Apex',
    tags: ['VIP'],
    status: 'open',
    assignedAgent: 'Sanket',
    custom1: '',
    custom2: '',
    attachmentUrl: 'https://example.com/priya_invoice.pdf',
    attachmentName: 'priya_invoice.pdf',
    notes: '',
    unreadCount: 0,
    lastMessagePreview: '',
    lastMessageAt: '2026-11-22T09:00:00.000Z',
  };

  const queue = buildBulkRecipients([contact], '9820112233, 9876543210, invalid-num', '91');
  assert.equal(queue.valid.length, 2);
  assert.equal(queue.invalidEntries.length, 1);
  assert.equal(queue.invalidEntries[0], 'invalid-num');

  const perContactAtt = resolveRecipientAttachment('per-contact', null, contact);
  assert.equal(perContactAtt?.name, 'priya_invoice.pdf');
  assert.equal(perContactAtt?.kind, 'document');
  assert.equal(inferAttachmentKind('image/png', 'promo.png'), 'image');
  assert.equal(isSafeHttpsUrl('https://drive.google.com/uc?id=1'), true);
  assert.equal(isSafeHttpsUrl('javascript:alert(1)'), false);
});

test('generateAppsScriptCode uses Main Drive Folder ID & ScriptProperties without embedding API secrets or IDs', () => {
  const code = generateAppsScriptCode({
    folderId: '1BcTFrvL7SKDKPfOE-iq4LPm61wLcJqna',
    businessName: 'SNC Whats App',
    apiVersion: 'v25.0',
  });

  assert.ok(code.includes("DEFAULT_DRIVE_FOLDER_ID: '1BcTFrvL7SKDKPfOE-iq4LPm61wLcJqna'"));
  assert.ok(code.includes('Connected_Sheets'));
  assert.ok(code.includes('syncMetaTemplatesToSheet'));
  assert.ok(code.includes('createMetaTemplate_'));
  assert.ok(code.includes('logExternalSend'));
  assert.ok(code.includes('syncExternalSheetsNow'));
  assert.ok(code.includes('downloadMetaMediaToDrive_'));
  assert.ok(code.includes("action === 'getMessages'"));
  assert.ok(code.includes('PropertiesService.getScriptProperties()'));
  assert.equal(code.includes('EAAR'), false);
  assert.equal(code.includes('392202937311812'), false);
  assert.equal(code.includes('397147030147130'), false);

  const snippet = generateExternalSheetPushSnippet({
    masterWebAppUrl: 'https://script.google.com/macros/s/demo/exec',
    sourceSheetName: 'GST_Receipt_AutoSender',
  });
  assert.ok(snippet.includes('logExternalSend'));
  assert.ok(snippet.includes('GST_Receipt_AutoSender'));
});

test('dedupeMessages removes duplicate message IDs and waMessageIds while keeping highest status', () => {
  const base: ChatMessage[] = [
    {
      id: 'msg-102',
      contactId: 'cnt-priya',
      phone: '919820112233',
      contactName: 'Priya Sharma',
      direction: 'inbound',
      type: 'text',
      body: 'Thanks! Can you also include the GST invoice?',
      status: 'delivered',
      waMessageId: 'wamid.102',
      timestamp: '2026-11-22T09:10:00.000Z',
    },
    {
      id: 'msg-103',
      contactId: 'cnt-arjun',
      phone: '919811223344',
      contactName: 'Arjun Mehta',
      direction: 'inbound',
      type: 'text',
      body: 'Order received.',
      status: 'sent',
      waMessageId: 'wamid.103',
      timestamp: '2026-11-22T09:15:00.000Z',
    },
    {
      id: 'msg-102',
      contactId: 'cnt-priya',
      phone: '919820112233',
      contactName: 'Priya Sharma',
      direction: 'inbound',
      type: 'text',
      body: 'Thanks! Can you also include the GST invoice?',
      status: 'read',
      timestamp: '2026-11-22T09:10:00.000Z',
    },
    {
      id: 'script-row-99',
      contactId: 'cnt-arjun',
      phone: '919811223344',
      contactName: 'Arjun Mehta',
      direction: 'inbound',
      type: 'text',
      body: 'Order received.',
      status: 'delivered',
      waMessageId: 'wamid.103',
      timestamp: '2026-11-22T09:15:00.000Z',
    },
  ];

  const deduped = dedupeMessages(base);
  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].id, 'msg-102');
  assert.equal(deduped[0].status, 'read');
  assert.equal(deduped[0].waMessageId, 'wamid.102');
  assert.equal(deduped[1].id, 'msg-103');
  assert.equal(deduped[1].status, 'delivered');
});

test('computeDashboardAnalytics aggregates Daily/Weekly/Monthly totals, spend, and Web App vs External Sheets', () => {
  const msgs: ChatMessage[] = [
    {
      id: 'm1',
      contactId: 'c1',
      phone: '919820112233',
      contactName: 'Priya',
      direction: 'outbound',
      type: 'template',
      body: 'Promo offer',
      templateName: 'festive_catalog_launch',
      status: 'read',
      timestamp: '2026-11-22T08:00:00.000Z',
      sourceSheet: 'SNC Web App',
      category: 'MARKETING',
      deliveredAt: '2026-11-22T08:00:05.000Z',
      readAt: '2026-11-22T08:01:00.000Z',
      billable: true,
    },
    {
      id: 'm2',
      contactId: 'c1',
      phone: '919820112233',
      contactName: 'Priya',
      direction: 'inbound',
      type: 'text',
      body: 'Interested!',
      status: 'delivered',
      timestamp: '2026-11-22T08:05:00.000Z',
      sourceSheet: 'SNC Web App',
      category: 'SERVICE',
    },
    {
      id: 'm3',
      contactId: 'c2',
      phone: '919811223344',
      contactName: 'Arjun',
      direction: 'outbound',
      type: 'document',
      body: 'Receipt REC-101 attached',
      templateName: 'payment_receipt_pdf',
      status: 'delivered',
      timestamp: '2026-11-21T10:00:00.000Z',
      sourceSheet: 'GST_Receipt_AutoSender',
      category: 'UTILITY',
      receiptNo: 'REC-101',
      deliveredAt: '2026-11-21T10:00:04.000Z',
      billable: true,
    },
    {
      id: 'm4',
      contactId: 'c3',
      phone: '919899000111',
      contactName: 'Failed Contact',
      direction: 'outbound',
      type: 'template',
      body: 'Receipt failed',
      templateName: 'payment_receipt_pdf',
      status: 'failed',
      timestamp: '2026-11-20T10:00:00.000Z',
      sourceSheet: 'GST_Receipt_AutoSender',
      category: 'UTILITY',
      billable: false,
    },
  ];

  const anchorIso = '2026-11-22T12:00:00.000Z';
  const daily = computeDashboardAnalytics(msgs, 'daily', DEFAULT_PRICING_RATES, {
    sourceFilter: 'ALL',
    anchorIso,
  });
  assert.equal(daily.totalSent, 3);
  assert.equal(daily.totalDelivered, 2);
  assert.equal(daily.totalRead, 1);
  assert.equal(daily.totalReplied, 1);
  assert.equal(daily.totalFailed, 1);
  assert.equal(daily.webAppSent, 1);
  assert.equal(daily.externalSheetSent, 2);
  assert.equal(daily.totalSpend, Number((0.8631 + 0.115).toFixed(2)));
  assert.equal(daily.series.length, 14);
  assert.equal(daily.sourceBreakdown.length, 2);

  const weekly = computeDashboardAnalytics(msgs, 'weekly', DEFAULT_PRICING_RATES, {
    sourceFilter: 'ALL',
    anchorIso,
  });
  assert.equal(weekly.series.length, 8);

  const monthly = computeDashboardAnalytics(msgs, 'monthly', DEFAULT_PRICING_RATES, {
    sourceFilter: 'ALL',
    anchorIso,
  });
  assert.equal(monthly.series.length, 6);
});

test('filterReportMessages, buildCustomReportCsv (formula-safe), and buildCustomReportExcelXml work accurately', () => {
  const msgs: ChatMessage[] = [
    {
      id: 'r1',
      contactId: 'c1',
      phone: '919820112233',
      contactName: '=HYPERLINK("http://evil","Click")',
      direction: 'outbound',
      type: 'document',
      body: 'Receipt attached',
      templateName: 'payment_receipt_pdf',
      status: 'read',
      timestamp: '2026-11-22T09:00:00.000Z',
      sourceSheet: 'GST_Receipt_AutoSender',
      category: 'UTILITY',
      receiptNo: 'REC-777',
    },
  ];

  const filtered = filterReportMessages(msgs, {
    direction: 'outbound',
    status: 'read',
    category: 'UTILITY',
    sourceSheet: 'GST_Receipt_AutoSender',
    templateName: 'ALL',
    searchQuery: 'REC-777',
  });
  assert.equal(filtered.length, 1);

  const csv = buildCustomReportCsv(
    filtered,
    ['contactName', 'phone', 'receiptNo', 'estimatedCost'],
    DEFAULT_PRICING_RATES
  );
  // Neutralizes formula injection with leading apostrophe
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes('REC-777'));

  const xls = buildCustomReportExcelXml(
    filtered,
    ['contactName', 'receiptNo'],
    DEFAULT_PRICING_RATES,
    'SNC Report'
  );
  assert.ok(xls.includes('<Workbook'));
  assert.ok(xls.includes('REC-777'));
});

test('validateMetaTemplateInput and buildMetaTemplatePayload convert named tokens to positional Meta v25.0 format', () => {
  const check = validateMetaTemplateInput({
    name: 'GST Receipt Alert 2026!',
    body: 'Hello {{name}}, receipt {{receipt_no}} is ready.',
    category: 'UTILITY',
    headerType: 'DOCUMENT',
  });
  assert.equal(check.ok, true);
  assert.equal(check.sanitizedName, 'gst_receipt_alert_2026');
  assert.deepEqual(check.variables, ['name', 'receipt_no']);

  const payload = buildMetaTemplatePayload({
    name: 'GST Receipt Alert 2026!',
    category: 'UTILITY',
    language: 'en_US',
    headerType: 'DOCUMENT',
    body: 'Hello {{name}}, receipt {{receipt_no}} is ready.',
    footer: 'SNC Whats App',
    exampleValues: ['Priya Sharma', 'REC-901'],
    buttons: [{ type: 'QUICK_REPLY', text: 'Thanks' }],
  });

  assert.equal(payload.name, 'gst_receipt_alert_2026');
  assert.equal(payload.category, 'UTILITY');
  const comps = payload.components as Array<Record<string, unknown>>;
  assert.equal(comps[0].type, 'HEADER');
  assert.equal(comps[0].format, 'DOCUMENT');
  assert.equal(comps[1].type, 'BODY');
  assert.equal(comps[1].text, 'Hello {{1}}, receipt {{2}} is ready.');
  assert.deepEqual(comps[1].example, { body_text: [['Priya Sharma', 'REC-901']] });
  assert.equal(comps[2].type, 'FOOTER');
  assert.equal(comps[3].type, 'BUTTONS');
});

test('parseRawTableForMapping, mapCustomRowsToContacts, and parseExternalSheetMessages handle custom sheets', () => {
  const tsv = [
    'Client Full Name\tMobile No\tReceipt Ref\tPDF Link',
    'Rohan Kulkarni\t9820554433\tREC-551\thttps://drive.google.com/uc?id=rec551',
    'Invalid Row\t1234\tREC-552\t',
  ].join('\n');

  const parsed = parseRawTableForMapping(tsv);
  assert.equal(parsed.headers.length, 4);
  assert.equal(parsed.suggestedMapping.name, 0);
  assert.equal(parsed.suggestedMapping.phone, 1);
  assert.equal(parsed.suggestedMapping.custom1, 2);
  assert.equal(parsed.suggestedMapping.attachmentUrl, 3);

  const mapped = mapCustomRowsToContacts(parsed.rows, parsed.suggestedMapping, '91');
  assert.equal(mapped.contacts.length, 1);
  assert.equal(mapped.skippedRows, 1);
  assert.equal(mapped.contacts[0].phone, '919820554433');
  assert.equal(mapped.contacts[0].custom1, 'REC-551');

  const source: ExternalSheetSource = {
    id: 'ext-gst',
    label: 'GST_Receipt_AutoSender',
    spreadsheetId: 'sheet123',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet123/edit',
    tabName: 'Sent_Receipts',
    defaultTemplate: 'payment_receipt_pdf',
    defaultCategory: 'UTILITY',
    colPhone: 'Phone',
    colName: 'Customer',
    colMessage: 'Message',
    colWaId: 'WAMID',
    colStatus: 'Status',
    colTimestamp: 'Sent_At',
    colAttachmentUrl: 'Receipt_URL',
    colReceiptNo: 'Receipt_No',
    enabled: true,
    lastSyncedRow: 0,
    lastSyncedAt: null,
    totalSynced: 0,
  };

  const extRows = [
    ['Customer', 'Phone', 'Receipt_No', 'Status', 'WAMID', 'Sent_At', 'Receipt_URL'],
    [
      'Neha Desai',
      '9820119988',
      'REC-881',
      'Read',
      'wamid.ext881',
      '2026-11-22T09:30:00.000Z',
      'https://drive.google.com/uc?id=881',
    ],
  ];
  const extMsgs = parseExternalSheetMessages(extRows, source, '91');
  assert.equal(extMsgs.length, 1);
  assert.equal(extMsgs[0].sourceSheet, 'GST_Receipt_AutoSender');
  assert.equal(extMsgs[0].status, 'read');
  assert.equal(extMsgs[0].receiptNo, 'REC-881');
  assert.equal(extMsgs[0].phone, '919820119988');
  assert.equal(extMsgs[0].attachment?.url, 'https://drive.google.com/uc?id=881');
});

test('normalizeDriveDownloadUrl converts Drive view/open URLs to direct download binary links', async () => {
  const { normalizeDriveDownloadUrl } = await import('./whatsappLogic');
  assert.equal(
    normalizeDriveDownloadUrl('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view?usp=sharing'),
    'https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMnOpQrStUvWxYz&export=download&authuser=0'
  );
  assert.equal(
    normalizeDriveDownloadUrl('https://drive.google.com/open?id=1XyZ9876543210'),
    'https://drive.usercontent.google.com/download?id=1XyZ9876543210&export=download&authuser=0'
  );
  assert.equal(
    normalizeDriveDownloadUrl('https://example.com/invoice.pdf'),
    'https://example.com/invoice.pdf'
  );
});

test('compute24HourWindow accurately computes open vs expired Meta 24-hour customer care windows', async () => {
  const { compute24HourWindow } = await import('./whatsappLogic');
  const nowMs = new Date('2026-11-22T12:00:00.000Z').getTime();

  const openWindow = compute24HourWindow(
    [
      {
        id: 'in-1',
        contactId: 'c1',
        phone: '919820112233',
        contactName: 'Priya',
        direction: 'inbound',
        type: 'text',
        body: 'Hi',
        status: 'delivered',
        timestamp: '2026-11-22T06:00:00.000Z',
      },
    ],
    nowMs
  );
  assert.equal(openWindow.active, true);
  assert.equal(openWindow.hours, 18);
  assert.equal(openWindow.minutes, 0);

  const expiredWindow = compute24HourWindow(
    [
      {
        id: 'in-old',
        contactId: 'c1',
        phone: '919820112233',
        contactName: 'Priya',
        direction: 'inbound',
        type: 'text',
        body: 'Old message',
        status: 'delivered',
        timestamp: '2026-11-20T06:00:00.000Z',
      },
    ],
    nowMs
  );
  assert.equal(expiredWindow.active, false);
});

test('tokenizeWhatsAppMarkdown parses bold, italic, strike, monospace safely without HTML injection', async () => {
  const { tokenizeWhatsAppMarkdown } = await import('./whatsappLogic');
  const tokens = tokenizeWhatsAppMarkdown('Pay *₹4,200* via _UPI_ ~old~ `REF-101` <script>alert(1)</script>');
  assert.ok(tokens.some((t) => t.type === 'bold' && t.value === '₹4,200'));
  assert.ok(tokens.some((t) => t.type === 'italic' && t.value === 'UPI'));
  assert.ok(tokens.some((t) => t.type === 'strike' && t.value === 'old'));
  assert.ok(tokens.some((t) => t.type === 'code' && t.value === 'REF-101'));
  assert.ok(tokens.some((t) => t.type === 'text' && t.value.includes('<script>alert(1)</script>')));
});

test('buildUpiPaymentLink and verifySecurityPinHash enforce valid UPI URIs and constant-time SHA-256 PIN check', async () => {
  const { buildUpiPaymentLink, verifySecurityPinHash } = await import('./whatsappLogic');
  const link = buildUpiPaymentLink({
    vpa: 'snc.parag@upi',
    payeeName: 'Parag Sureshrao Chaware SNC',
    amount: 4250.5,
    note: 'Invoice INV-4821',
  });
  assert.ok(link.startsWith('upi://pay?'));
  assert.ok(link.includes('pa=snc.parag%40upi'));
  assert.ok(link.includes('am=4250.50'));
  assert.ok(link.includes('cu=INR'));

  assert.equal(await verifySecurityPinHash('2026'), true);
  assert.equal(await verifySecurityPinHash('0000'), false);
  assert.equal(await verifySecurityPinHash(''), false);
});

test('Dual Apps Script generators (Gateway_Code.gs, Worker_Code.gs, Retailer Sheet) contain zero hardcoded tokens or IDs', async () => {
  const {
    generateGatewayAppsScriptCode,
    generateWorkerAppsScriptCode,
    generateRetailerSheetDropInScript,
  } = await import('./appsScriptTemplate');

  const gateway = generateGatewayAppsScriptCode({
    folderId: '1BcTFrvL7SKDKPfOE-iq4LPm61wLcJqna',
    businessName: 'Parag Sureshrao Chaware - SNC',
    apiVersion: 'v25.0',
  });
  assert.ok(gateway.includes('Shards_Registry'));
  assert.ok(gateway.includes('send_otp'));
  assert.ok(gateway.includes('verify_otp'));
  assert.ok(gateway.includes('#opt_out'));
  assert.ok(gateway.includes('fetch_meta_insights'));
  assert.ok(gateway.includes('queue_bulk_campaign'));
  assert.ok(gateway.includes('getWorkspaceBootstrap'));
  assert.ok(gateway.includes('status=APPROVED'));
  assert.ok(gateway.includes('listDriveFiles'));
  assert.ok(gateway.includes('deleteDriveFile'));
  assert.ok(gateway.includes('importExternalSheetContacts'));
  assert.ok(gateway.includes('downloadMetaMediaToDrive_'));
  assert.ok(gateway.includes('1BcTFrvL7SKDKPfOE-iq4LPm61wLcJqna'));
  assert.equal(gateway.includes('EAAR'), false);

  const worker = generateWorkerAppsScriptCode({
    folderId: '1BcTFrvL7SKDKPfOE-iq4LPm61wLcJqna',
    businessName: 'Parag Sureshrao Chaware - SNC',
    apiVersion: 'v25.0',
  });
  assert.ok(worker.includes('processBulkQueueBatch'));
  assert.ok(worker.includes('checkAndRotateShard'));
  assert.ok(worker.includes('nightlyWorkspaceBackup'));
  assert.ok(worker.includes('30000'));
  assert.equal(worker.includes('EAAR'), false);

  const retailer = generateRetailerSheetDropInScript({
    apiVersion: 'v25.0',
  });
  assert.ok(retailer.includes('PropertiesService.getScriptProperties()'));
  assert.ok(retailer.includes('WHATSAPP_PHONE_ID'));
  assert.ok(retailer.includes('MASTER_GATEWAY_URL'));
  assert.ok(retailer.includes('retailer_receipt'));
  assert.equal(retailer.includes('EAAR'), false);
});

test('parseApprovedTemplateSchema detects exact Marathi/English parameter formats (Text, Number, Date, Link, Media Header)', async () => {
  const {
    parseApprovedTemplateSchema,
    renderApprovedTemplatePreview,
    getDriveViewableThumbnailUrl,
    getDriveBrowserViewUrl,
  } = await import('./whatsappLogic');

  const farmerReceiptTpl = {
    id: 'tpl-farmer',
    name: 'farmer_receipt',
    category: 'UTILITY' as const,
    language: 'mr',
    headerType: 'DOCUMENT' as const,
    body: 'नमस्कार {{1}},\nदिनांक {{2}} रोजी विक्री केलेल्या मालाचे बिल रक्कम ₹{{3}}. लिंक: {{4}}',
    variables: ['1', '2', '3', '4'],
    status: 'APPROVED' as const,
    updatedAt: '2026-11-22T00:00:00.000Z',
  };

  const schema = parseApprovedTemplateSchema(farmerReceiptTpl);
  assert.equal(schema.headerMediaType, 'DOCUMENT');
  assert.equal(schema.bodyFields.length, 4);
  assert.equal(schema.bodyFields[0].formatLabel, 'Text');
  assert.equal(schema.bodyFields[1].formatLabel, 'Date');
  assert.equal(schema.bodyFields[2].formatLabel, 'Number');
  assert.equal(schema.bodyFields[3].formatLabel, 'Link');

  const preview = renderApprovedTemplatePreview(farmerReceiptTpl, [
    'संकित राठोड',
    '22-11-2026',
    '15400',
    'https://drive.google.com/file/d/abc123/view',
  ]);
  assert.ok(preview.bodyPreview.includes('संकित राठोड'));
  assert.ok(preview.bodyPreview.includes('22-11-2026'));
  assert.ok(preview.bodyPreview.includes('15400'));

  const helloWorldTpl = {
    id: 'tpl-hello',
    name: 'hello_world',
    category: 'UTILITY' as const,
    language: 'en_US',
    headerType: 'NONE' as const,
    body: 'Welcome and congratulations!! This message demonstrates your ability to send a WhatsApp message notification from the Cloud API.',
    variables: [],
    status: 'APPROVED' as const,
    updatedAt: '2026-11-22T00:00:00.000Z',
  };
  const zeroParamSchema = parseApprovedTemplateSchema(helloWorldTpl);
  assert.equal(zeroParamSchema.headerMediaType, 'NONE');
  assert.equal(zeroParamSchema.bodyFields.length, 0);

  assert.equal(
    getDriveViewableThumbnailUrl('https://drive.google.com/file/d/1AbCDef123/view'),
    'https://drive.google.com/thumbnail?id=1AbCDef123&sz=w1000'
  );
  assert.equal(
    getDriveBrowserViewUrl('https://drive.usercontent.google.com/download?id=1AbCDef123&export=download'),
    'https://drive.google.com/file/d/1AbCDef123/view'
  );
});

test('Workspace initializes with ZERO dummy contacts, messages, templates, campaigns, Drive files, or preconceived Folder/Sheet IDs', async () => {
  const {
    INITIAL_CAMPAIGNS,
    INITIAL_CONTACTS,
    INITIAL_DRIVE_FILES,
    INITIAL_EXTERNAL_SHEETS,
    INITIAL_MESSAGES,
    INITIAL_TEMPLATES,
    INITIAL_WORKSPACE_CONFIG,
    MAIN_DRIVE_FOLDER_ID,
  } = await import('../data/seedData');

  assert.equal(INITIAL_CONTACTS.length, 0);
  assert.equal(INITIAL_MESSAGES.length, 0);
  assert.equal(INITIAL_TEMPLATES.length, 0);
  assert.equal(INITIAL_CAMPAIGNS.length, 0);
  assert.equal(INITIAL_DRIVE_FILES.length, 0);
  assert.equal(INITIAL_EXTERNAL_SHEETS.length, 0);
  assert.equal(MAIN_DRIVE_FOLDER_ID, '');
  assert.equal(INITIAL_WORKSPACE_CONFIG.driveFolderId, '');
  assert.equal(INITIAL_WORKSPACE_CONFIG.spreadsheetId, '');
  assert.equal(INITIAL_WORKSPACE_CONFIG.appsScriptWebAppUrl, '');
});

test('Authorized OTP admins include 919922775569, PDF uploads use Meta /media application/pdf, and printable HTML escapes output safely', async () => {
  const { AUTHORIZED_OPERATORS, INITIAL_WORKSPACE_CONFIG } = await import('../data/seedData');
  const { generateGatewayAppsScriptCode, generateRetailerSheetDropInScript } = await import(
    './appsScriptTemplate'
  );
  const { buildPrintableReportHtml, buildSetupGuidePdfHtml } = await import('./printableReports');

  assert.equal(AUTHORIZED_OPERATORS.length, 3);
  assert.ok(AUTHORIZED_OPERATORS.some((op) => op.phone === '919922775569'));

  const gatewayScript = generateGatewayAppsScriptCode({});
  assert.ok(gatewayScript.includes('919922775569'));
  assert.ok(gatewayScript.includes('driveFolderId'));
  assert.ok(gatewayScript.includes('campaignId'));
  assert.ok(gatewayScript.includes('uploadMediaToMeta_'));
  assert.ok(gatewayScript.includes('buildMetaMultipartBytes_'));
  assert.ok(gatewayScript.includes('uploadBlobToMetaMultipart_'));
  assert.ok(gatewayScript.includes("contentType: 'multipart/form-data; boundary=' + boundary"));
  assert.ok(gatewayScript.includes("rawMime = 'application/pdf'"));
  assert.ok(gatewayScript.includes("DEFAULT_DRIVE_FOLDER_ID: ''"));
  assert.ok(gatewayScript.includes('requireOtpSession_'));
  assert.ok(gatewayScript.includes('handleLogout_'));
  assert.ok(gatewayScript.includes('authExpired: true'));
  assert.ok(gatewayScript.includes('snc_otp_cd_'));

  const retailerScript = generateRetailerSheetDropInScript({});
  assert.ok(retailerScript.includes('uploadReceiptPdfToMeta_'));
  assert.ok(retailerScript.includes("Content-Type: application/pdf"));
  assert.ok(retailerScript.includes("contentType: 'multipart/form-data; boundary=' + boundary"));

  const reportHtml = buildPrintableReportHtml({
    businessName: 'SNC <script>alert(1)</script> WhatsApp',
    filtersSummary: 'All Channels',
    selectedColumns: ['contactName', 'phone', 'status'],
    messages: [
      {
        id: 'm-1',
        contactId: 'c-1',
        phone: '919922775569',
        contactName: '<b>Sanket</b>',
        direction: 'outbound',
        type: 'template',
        body: 'Hello',
        status: 'read',
        timestamp: '2026-11-23T09:00:00.000Z',
        category: 'UTILITY',
      },
    ],
    pricing: DEFAULT_PRICING_RATES,
  });
  assert.ok(!reportHtml.includes('<script>alert(1)</script>'));
  assert.ok(reportHtml.includes('&lt;b&gt;Sanket&lt;/b&gt;'));
  assert.ok(reportHtml.includes('window.print()'));
  assert.ok(reportHtml.includes('&copy; 2026 QuantumDynamics Data Solution. All Rights Reserved.'));

  const guideHtml = buildSetupGuidePdfHtml(INITIAL_WORKSPACE_CONFIG);
  assert.ok(guideHtml.includes('Auto-detected from Apps Script Gateway'));
  assert.ok(guideHtml.includes('&copy; 2026 QuantumDynamics Data Solution. All Rights Reserved.'));
});



