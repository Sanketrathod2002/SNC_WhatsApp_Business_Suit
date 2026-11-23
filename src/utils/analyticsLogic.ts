import type {
  AnalyticsTimeframe,
  ChatMessage,
  Contact,
  ExternalSheetSource,
  MessageBillingCategory,
  MessageDeliveryStatus,
  MessageTemplate,
  PricingRatesConfig,
  TemplateButton,
} from '../types';
import {
  extractTemplateVariables,
  inferAttachmentKind,
  isSafeHttpsUrl,
  isValidPhone,
  normalizePhone,
} from './whatsappLogic';

export const DEFAULT_PRICING_RATES: PricingRatesConfig = {
  currency: 'INR',
  marketing: 0.8631,
  utility: 0.115,
  authentication: 0.115,
  service: 0,
};

export interface AnalyticsBucketPoint {
  bucketKey: string;
  label: string;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  failed: number;
  spend: number;
}

export interface CategorySpendRow {
  category: MessageBillingCategory;
  sent: number;
  billableCount: number;
  unitRate: number;
  spend: number;
}

export interface SourceSheetBreakdownRow {
  sourceSheet: string;
  isExternal: boolean;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  failed: number;
  deliveryRate: number;
  readRate: number;
  replyRate: number;
  spend: number;
  lastActivityAt: string;
}

export interface TemplatePerformanceRow {
  templateName: string;
  category: MessageBillingCategory;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  failed: number;
  readRate: number;
  replyRate: number;
  spend: number;
}

export interface DashboardAnalyticsResult {
  totalSent: number;
  totalDelivered: number;
  totalRead: number;
  totalReplied: number;
  totalFailed: number;
  totalInbound: number;
  deliveryRate: number;
  readRate: number;
  replyRate: number;
  totalSpend: number;
  webAppSent: number;
  externalSheetSent: number;
  series: AnalyticsBucketPoint[];
  categoryBreakdown: CategorySpendRow[];
  sourceBreakdown: SourceSheetBreakdownRow[];
  templateBreakdown: TemplatePerformanceRow[];
  availableSources: string[];
}

export function inferMessageCategory(msg: ChatMessage): MessageBillingCategory {
  if (msg.category) return msg.category;
  if (msg.direction === 'inbound') return 'SERVICE';
  const tpl = (msg.templateName || '').toLowerCase();
  if (tpl.includes('otp') || tpl.includes('auth') || tpl.includes('verify')) {
    return 'AUTHENTICATION';
  }
  if (
    tpl.includes('catalog') ||
    tpl.includes('promo') ||
    tpl.includes('festive') ||
    tpl.includes('welcome') ||
    tpl.includes('offer')
  ) {
    return 'MARKETING';
  }
  if (
    tpl.includes('order') ||
    tpl.includes('invoice') ||
    tpl.includes('receipt') ||
    tpl.includes('dispatch') ||
    tpl.includes('payment') ||
    msg.receiptNo ||
    msg.type === 'template'
  ) {
    return 'UTILITY';
  }
  return 'SERVICE';
}

export function getRateForCategory(
  category: MessageBillingCategory,
  pricing: PricingRatesConfig
): number {
  switch (category) {
    case 'MARKETING':
      return Number(pricing.marketing) || 0;
    case 'UTILITY':
      return Number(pricing.utility) || 0;
    case 'AUTHENTICATION':
      return Number(pricing.authentication) || 0;
    case 'SERVICE':
    default:
      return Number(pricing.service) || 0;
  }
}

export function estimateMessageCost(
  msg: ChatMessage,
  pricing: PricingRatesConfig
): number {
  if (msg.direction !== 'outbound' || msg.status === 'failed' || msg.status === 'queued') {
    return 0;
  }
  if (msg.billable === false) {
    return 0;
  }
  const category = inferMessageCategory(msg);
  if (category === 'SERVICE') return 0;
  return getRateForCategory(category, pricing);
}

export function formatCurrencyAmount(amount: number, currency: 'INR' | 'USD'): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  if (currency === 'USD') {
    return `$${safe.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return `₹${safe.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function getIsoWeekStart(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d;
}

function formatShortDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function formatShortMonth(ym: string): string {
  const d = new Date(`${ym}-01T00:00:00.000Z`);
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

function getBucketForDate(
  date: Date,
  timeframe: AnalyticsTimeframe
): { key: string; label: string } {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');

  if (timeframe === 'daily') {
    const key = `${y}-${m}-${d}`;
    return { key, label: formatShortDay(key) };
  }
  if (timeframe === 'weekly') {
    const monday = getIsoWeekStart(date);
    const wy = monday.getUTCFullYear();
    const wm = String(monday.getUTCMonth() + 1).padStart(2, '0');
    const wd = String(monday.getUTCDate()).padStart(2, '0');
    const key = `${wy}-${wm}-${wd}`;
    return { key, label: `Wk ${formatShortDay(key)}` };
  }
  const key = `${y}-${m}`;
  return { key, label: formatShortMonth(key) };
}

function buildReferenceBuckets(
  anchorDate: Date,
  timeframe: AnalyticsTimeframe
): AnalyticsBucketPoint[] {
  const buckets: AnalyticsBucketPoint[] = [];
  if (timeframe === 'daily') {
    for (let i = 13; i >= 0; i--) {
      const dt = new Date(
        Date.UTC(
          anchorDate.getUTCFullYear(),
          anchorDate.getUTCMonth(),
          anchorDate.getUTCDate() - i
        )
      );
      const { key, label } = getBucketForDate(dt, 'daily');
      buckets.push({
        bucketKey: key,
        label,
        sent: 0,
        delivered: 0,
        read: 0,
        replied: 0,
        failed: 0,
        spend: 0,
      });
    }
    return buckets;
  }

  if (timeframe === 'weekly') {
    const currentWeekStart = getIsoWeekStart(anchorDate);
    for (let i = 7; i >= 0; i--) {
      const dt = new Date(currentWeekStart.getTime() - i * 7 * 24 * 60 * 60 * 1000);
      const { key, label } = getBucketForDate(dt, 'weekly');
      buckets.push({
        bucketKey: key,
        label,
        sent: 0,
        delivered: 0,
        read: 0,
        replied: 0,
        failed: 0,
        spend: 0,
      });
    }
    return buckets;
  }

  for (let i = 5; i >= 0; i--) {
    const dt = new Date(
      Date.UTC(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth() - i, 1)
    );
    const { key, label } = getBucketForDate(dt, 'monthly');
    buckets.push({
      bucketKey: key,
      label,
      sent: 0,
      delivered: 0,
      read: 0,
      replied: 0,
      failed: 0,
      spend: 0,
    });
  }
  return buckets;
}

/**
 * Computes executive analytics across Web App + External Receipt Google Sheets
 * for Daily, Weekly, or Monthly views, including Meta category spend and reply attribution.
 */
export function computeDashboardAnalytics(
  allMessages: ChatMessage[],
  timeframe: AnalyticsTimeframe,
  pricing: PricingRatesConfig = DEFAULT_PRICING_RATES,
  options: {
    sourceFilter?: string; // 'ALL' | 'SNC Web App' | external sheet label
    anchorIso?: string;
  } = {}
): DashboardAnalyticsResult {
  const sourceFilter = options.sourceFilter || 'ALL';

  const sourceSet = new Set<string>(['SNC Web App']);
  for (const m of allMessages) {
    if (m.direction === 'outbound') {
      sourceSet.add((m.sourceSheet || 'SNC Web App').trim() || 'SNC Web App');
    }
  }
  const availableSources = Array.from(sourceSet);

  // Build inbound timestamp lookup per normalized phone for reply attribution
  const inboundByPhone = new Map<string, number[]>();
  for (const m of allMessages) {
    if (m.direction === 'inbound') {
      const ts = new Date(m.timestamp).getTime();
      if (!Number.isFinite(ts)) continue;
      const key = m.phone.replace(/\D/g, '');
      const list = inboundByPhone.get(key) || [];
      list.push(ts);
      inboundByPhone.set(key, list);
    }
  }
  for (const list of inboundByPhone.values()) {
    list.sort((a, b) => a - b);
  }

  // Determine anchor date from option or latest message timestamp
  let latestTs = options.anchorIso ? new Date(options.anchorIso).getTime() : 0;
  if (!latestTs) {
    for (const m of allMessages) {
      const t = new Date(m.timestamp).getTime();
      if (Number.isFinite(t) && t > latestTs) latestTs = t;
    }
  }
  const anchorDate = new Date(latestTs || Date.now());

  const series = buildReferenceBuckets(anchorDate, timeframe);
  const bucketMap = new Map(series.map((b) => [b.bucketKey, b]));

  const categoryTotals: Record<
    MessageBillingCategory,
    { sent: number; billableCount: number; spend: number }
  > = {
    MARKETING: { sent: 0, billableCount: 0, spend: 0 },
    UTILITY: { sent: 0, billableCount: 0, spend: 0 },
    AUTHENTICATION: { sent: 0, billableCount: 0, spend: 0 },
    SERVICE: { sent: 0, billableCount: 0, spend: 0 },
  };

  const sourceMap = new Map<
    string,
    {
      sent: number;
      delivered: number;
      read: number;
      replied: number;
      failed: number;
      spend: number;
      lastActivityAt: string;
    }
  >();

  const templateMap = new Map<
    string,
    {
      category: MessageBillingCategory;
      sent: number;
      delivered: number;
      read: number;
      replied: number;
      failed: number;
      spend: number;
    }
  >();

  let totalSent = 0;
  let totalDelivered = 0;
  let totalRead = 0;
  let totalReplied = 0;
  let totalFailed = 0;
  let totalInbound = 0;
  let totalSpend = 0;
  let webAppSent = 0;
  let externalSheetSent = 0;

  for (const msg of allMessages) {
    if (msg.direction === 'inbound') {
      totalInbound++;
      continue;
    }

    const source = (msg.sourceSheet || 'SNC Web App').trim() || 'SNC Web App';
    if (sourceFilter !== 'ALL' && source !== sourceFilter) {
      continue;
    }

    const ts = new Date(msg.timestamp).getTime();
    if (!Number.isFinite(ts)) continue;
    const msgDate = new Date(ts);
    const { key: bucketKey } = getBucketForDate(msgDate, timeframe);
    const bucket = bucketMap.get(bucketKey);

    const isFailed = msg.status === 'failed';
    const isRead = msg.status === 'read' || Boolean(msg.readAt);
    const isDelivered =
      isRead || msg.status === 'delivered' || Boolean(msg.deliveredAt);

    // A message is considered "replied" if repliedAt is stamped OR an inbound reply
    // arrived from the same phone within 72 hours after sending.
    let isReplied = Boolean(msg.repliedAt);
    if (!isReplied && !isFailed) {
      const phoneKey = msg.phone.replace(/\D/g, '');
      const inboundList = inboundByPhone.get(phoneKey) || [];
      const windowEnd = ts + 72 * 60 * 60 * 1000;
      isReplied = inboundList.some((inTs) => inTs > ts && inTs <= windowEnd);
    }

    const category = inferMessageCategory(msg);
    const cost = estimateMessageCost(msg, pricing);

    totalSent++;
    if (isDelivered) totalDelivered++;
    if (isRead) totalRead++;
    if (isReplied) totalReplied++;
    if (isFailed) totalFailed++;
    totalSpend += cost;

    if (source === 'SNC Web App') {
      webAppSent++;
    } else {
      externalSheetSent++;
    }

    categoryTotals[category].sent++;
    if (cost > 0) {
      categoryTotals[category].billableCount++;
      categoryTotals[category].spend += cost;
    }

    if (bucket) {
      bucket.sent++;
      if (isDelivered) bucket.delivered++;
      if (isRead) bucket.read++;
      if (isReplied) bucket.replied++;
      if (isFailed) bucket.failed++;
      bucket.spend = Number((bucket.spend + cost).toFixed(4));
    }

    const srcRow = sourceMap.get(source) || {
      sent: 0,
      delivered: 0,
      read: 0,
      replied: 0,
      failed: 0,
      spend: 0,
      lastActivityAt: msg.timestamp,
    };
    srcRow.sent++;
    if (isDelivered) srcRow.delivered++;
    if (isRead) srcRow.read++;
    if (isReplied) srcRow.replied++;
    if (isFailed) srcRow.failed++;
    srcRow.spend += cost;
    if (msg.timestamp > srcRow.lastActivityAt) {
      srcRow.lastActivityAt = msg.timestamp;
    }
    sourceMap.set(source, srcRow);

    const tplKey = msg.templateName || 'Direct Chat / Freeform';
    const tplRow = templateMap.get(tplKey) || {
      category,
      sent: 0,
      delivered: 0,
      read: 0,
      replied: 0,
      failed: 0,
      spend: 0,
    };
    tplRow.sent++;
    if (isDelivered) tplRow.delivered++;
    if (isRead) tplRow.read++;
    if (isReplied) tplRow.replied++;
    if (isFailed) tplRow.failed++;
    tplRow.spend += cost;
    templateMap.set(tplKey, tplRow);
  }

  const pct = (part: number, whole: number) =>
    whole > 0 ? Number(((part / whole) * 100).toFixed(1)) : 0;

  const categoryBreakdown: CategorySpendRow[] = (
    ['MARKETING', 'UTILITY', 'AUTHENTICATION', 'SERVICE'] as MessageBillingCategory[]
  ).map((cat) => ({
    category: cat,
    sent: categoryTotals[cat].sent,
    billableCount: categoryTotals[cat].billableCount,
    unitRate: getRateForCategory(cat, pricing),
    spend: Number(categoryTotals[cat].spend.toFixed(2)),
  }));

  const sourceBreakdown: SourceSheetBreakdownRow[] = Array.from(sourceMap.entries())
    .map(([sourceSheet, row]) => ({
      sourceSheet,
      isExternal: sourceSheet !== 'SNC Web App',
      sent: row.sent,
      delivered: row.delivered,
      read: row.read,
      replied: row.replied,
      failed: row.failed,
      deliveryRate: pct(row.delivered, row.sent),
      readRate: pct(row.read, row.sent),
      replyRate: pct(row.replied, row.sent),
      spend: Number(row.spend.toFixed(2)),
      lastActivityAt: row.lastActivityAt,
    }))
    .sort((a, b) => b.sent - a.sent);

  const templateBreakdown: TemplatePerformanceRow[] = Array.from(templateMap.entries())
    .map(([templateName, row]) => ({
      templateName,
      category: row.category,
      sent: row.sent,
      delivered: row.delivered,
      read: row.read,
      replied: row.replied,
      failed: row.failed,
      readRate: pct(row.read, row.sent),
      replyRate: pct(row.replied, row.sent),
      spend: Number(row.spend.toFixed(2)),
    }))
    .sort((a, b) => b.sent - a.sent);

  return {
    totalSent,
    totalDelivered,
    totalRead,
    totalReplied,
    totalFailed,
    totalInbound,
    deliveryRate: pct(totalDelivered, totalSent),
    readRate: pct(totalRead, totalSent),
    replyRate: pct(totalReplied, totalSent),
    totalSpend: Number(totalSpend.toFixed(2)),
    webAppSent,
    externalSheetSent,
    series,
    categoryBreakdown,
    sourceBreakdown,
    templateBreakdown,
    availableSources,
  };
}

// ============================================================================
// CUSTOM REPORT FILTERING & FORMULA-SAFE CSV / EXCEL EXPORTS
// ============================================================================

export interface ReportFilterOptions {
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string; // YYYY-MM-DD
  direction: 'all' | 'outbound' | 'inbound';
  status: 'all' | MessageDeliveryStatus;
  category: 'all' | MessageBillingCategory;
  sourceSheet: string; // 'ALL' or specific sheet label
  templateName: string; // 'ALL' or specific template
  searchQuery?: string;
}

export type ReportColumnKey =
  | 'timestamp'
  | 'direction'
  | 'sourceSheet'
  | 'contactName'
  | 'phone'
  | 'templateName'
  | 'category'
  | 'body'
  | 'receiptNo'
  | 'attachmentName'
  | 'attachmentUrl'
  | 'status'
  | 'estimatedCost'
  | 'waMessageId'
  | 'error';

export const REPORT_COLUMN_DEFINITIONS: Array<{
  key: ReportColumnKey;
  label: string;
  defaultSelected: boolean;
}> = [
  { key: 'timestamp', label: 'Timestamp', defaultSelected: true },
  { key: 'direction', label: 'Direction', defaultSelected: true },
  { key: 'sourceSheet', label: 'Source Sheet', defaultSelected: true },
  { key: 'contactName', label: 'Contact Name', defaultSelected: true },
  { key: 'phone', label: 'Phone Number', defaultSelected: true },
  { key: 'templateName', label: 'Template Name', defaultSelected: true },
  { key: 'category', label: 'Billing Category', defaultSelected: true },
  { key: 'status', label: 'Delivery Status', defaultSelected: true },
  { key: 'receiptNo', label: 'Receipt / Ref No.', defaultSelected: true },
  { key: 'estimatedCost', label: 'Estimated Spend', defaultSelected: true },
  { key: 'body', label: 'Message Body', defaultSelected: false },
  { key: 'attachmentName', label: 'Attachment Name', defaultSelected: false },
  { key: 'attachmentUrl', label: 'Attachment URL', defaultSelected: false },
  { key: 'waMessageId', label: 'Meta Message ID', defaultSelected: false },
  { key: 'error', label: 'Error Details', defaultSelected: false },
];

export function filterReportMessages(
  messages: ChatMessage[],
  filters: ReportFilterOptions
): ChatMessage[] {
  const q = (filters.searchQuery || '').trim().toLowerCase();
  const fromTs = filters.dateFrom
    ? new Date(`${filters.dateFrom}T00:00:00.000Z`).getTime()
    : null;
  const toTs = filters.dateTo
    ? new Date(`${filters.dateTo}T23:59:59.999Z`).getTime()
    : null;

  return messages
    .filter((m) => {
      if (filters.direction !== 'all' && m.direction !== filters.direction) return false;
      if (filters.status !== 'all' && m.status !== filters.status) return false;
      const cat = inferMessageCategory(m);
      if (filters.category !== 'all' && cat !== filters.category) return false;
      const src = (m.sourceSheet || 'SNC Web App').trim() || 'SNC Web App';
      if (filters.sourceSheet !== 'ALL' && src !== filters.sourceSheet) return false;
      const tpl = m.templateName || 'Direct Chat / Freeform';
      if (filters.templateName !== 'ALL' && tpl !== filters.templateName) return false;

      const ts = new Date(m.timestamp).getTime();
      if (fromTs !== null && Number.isFinite(ts) && ts < fromTs) return false;
      if (toTs !== null && Number.isFinite(ts) && ts > toTs) return false;

      if (q) {
        const hay = `${m.contactName} ${m.phone} ${m.body} ${m.receiptNo || ''} ${
          m.templateName || ''
        } ${src}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

function getReportCellValue(
  msg: ChatMessage,
  col: ReportColumnKey,
  pricing: PricingRatesConfig
): string {
  switch (col) {
    case 'timestamp':
      return msg.timestamp;
    case 'direction':
      return msg.direction;
    case 'sourceSheet':
      return msg.sourceSheet || 'SNC Web App';
    case 'contactName':
      return msg.contactName;
    case 'phone':
      return msg.phone;
    case 'templateName':
      return msg.templateName || 'Direct Chat';
    case 'category':
      return inferMessageCategory(msg);
    case 'body':
      return msg.body;
    case 'receiptNo':
      return msg.receiptNo || '';
    case 'attachmentName':
      return msg.attachment?.name || '';
    case 'attachmentUrl':
      return msg.attachment?.url || '';
    case 'status':
      return msg.status;
    case 'estimatedCost':
      return estimateMessageCost(msg, pricing).toFixed(4);
    case 'waMessageId':
      return msg.waMessageId || '';
    case 'error':
      return msg.error || '';
    default:
      return '';
  }
}

/**
 * Neutralizes spreadsheet formula injection (leading =, +, -, @, tab, CR) and RFC-4180 escapes CSV cells.
 */
function sanitizeCsvCell(raw: string): string {
  let str = String(raw ?? '');
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCustomReportRows(
  messages: ChatMessage[],
  selectedColumns: ReportColumnKey[],
  pricing: PricingRatesConfig
): string[][] {
  const cols =
    selectedColumns.length > 0
      ? selectedColumns
      : REPORT_COLUMN_DEFINITIONS.filter((c) => c.defaultSelected).map((c) => c.key);

  const labelMap = new Map(REPORT_COLUMN_DEFINITIONS.map((c) => [c.key, c.label]));
  const headerRow = cols.map((k) => labelMap.get(k) || k);
  const bodyRows = messages.map((msg) =>
    cols.map((k) => getReportCellValue(msg, k, pricing))
  );
  return [headerRow, ...bodyRows];
}

export function buildCustomReportCsv(
  messages: ChatMessage[],
  selectedColumns: ReportColumnKey[],
  pricing: PricingRatesConfig
): string {
  const rows = buildCustomReportRows(messages, selectedColumns, pricing);
  return rows.map((r) => r.map(sanitizeCsvCell).join(',')).join('\n');
}

function escapeXml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generates an Excel-compatible SpreadsheetML (.xls) XML workbook with zero external dependencies.
 */
export function buildCustomReportExcelXml(
  messages: ChatMessage[],
  selectedColumns: ReportColumnKey[],
  pricing: PricingRatesConfig,
  sheetTitle = 'SNC_WhatsApp_Report'
): string {
  const rows = buildCustomReportRows(messages, selectedColumns, pricing);
  const safeTitle = escapeXml(sheetTitle.slice(0, 31));
  const xmlRows = rows
    .map((row, rowIdx) => {
      const cells = row
        .map((cell) => {
          const safe = /^[=+\-@]/.test(cell) ? `'${cell}` : cell;
          const styleAttr = rowIdx === 0 ? ' ss:StyleID="Header"' : '';
          return `<Cell${styleAttr}><Data ss:Type="String">${escapeXml(safe)}</Data></Cell>`;
        })
        .join('');
      return `<Row>${cells}</Row>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Header">
   <Font ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#075E54" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="${safeTitle}">
  <Table>
${xmlRows}
  </Table>
 </Worksheet>
</Workbook>`;
}

// ============================================================================
// META WHATSAPP TEMPLATE VALIDATION & PAYLOAD BUILDER
// ============================================================================

export function sanitizeMetaTemplateName(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 512);
}

export function validateMetaTemplateInput(input: {
  name: string;
  body: string;
  category: MessageTemplate['category'];
  headerType: MessageTemplate['headerType'];
  headerText?: string;
  exampleValues?: string[];
}): { ok: boolean; error?: string; sanitizedName: string; variables: string[] } {
  const sanitizedName = sanitizeMetaTemplateName(input.name);
  if (!sanitizedName || !/^[a-z][a-z0-9_]{1,511}$/.test(sanitizedName)) {
    return {
      ok: false,
      sanitizedName,
      variables: [],
      error:
        'Template name must start with a letter and contain only lowercase letters, numbers, and underscores.',
    };
  }
  const cleanBody = (input.body || '').trim();
  if (!cleanBody) {
    return {
      ok: false,
      sanitizedName,
      variables: [],
      error: 'Message body is required.',
    };
  }
  if (input.headerType === 'TEXT' && !(input.headerText || '').trim()) {
    return {
      ok: false,
      sanitizedName,
      variables: [],
      error: 'Enter header text or switch header type to None/Media.',
    };
  }
  const variables = extractTemplateVariables(cleanBody);
  return { ok: true, sanitizedName, variables };
}

/**
 * Builds an official Meta Cloud API v25.0 /{WABA_ID}/message_templates submission payload.
 * Automatically converts named placeholders like {{name}} to positional {{1}}, {{2}} for Meta
 * and attaches required example.body_text sample values.
 */
export function buildMetaTemplatePayload(input: {
  name: string;
  category: MessageTemplate['category'];
  language: string;
  headerType: MessageTemplate['headerType'];
  headerText?: string;
  body: string;
  footer?: string;
  exampleValues?: string[];
  buttons?: TemplateButton[];
}): Record<string, unknown> {
  const sanitizedName = sanitizeMetaTemplateName(input.name);
  const vars = extractTemplateVariables(input.body);

  // Convert any named tokens ({{name}}) into sequential positional tokens ({{1}}, {{2}}) for Meta API
  let metaBody = input.body.trim();
  vars.forEach((v, idx) => {
    const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    metaBody = metaBody.replace(
      new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, 'g'),
      `{{${idx + 1}}}`
    );
  });

  const components: Array<Record<string, unknown>> = [];

  if (input.headerType !== 'NONE') {
    if (input.headerType === 'TEXT') {
      components.push({
        type: 'HEADER',
        format: 'TEXT',
        text: (input.headerText || '').trim(),
      });
    } else {
      components.push({
        type: 'HEADER',
        format: input.headerType,
      });
    }
  }

  const bodyComponent: Record<string, unknown> = {
    type: 'BODY',
    text: metaBody,
  };
  if (vars.length > 0) {
    const samples = vars.map((v, i) => {
      const provided = (input.exampleValues?.[i] || '').trim();
      return provided || `Sample_${v}`;
    });
    bodyComponent.example = { body_text: [samples] };
  }
  components.push(bodyComponent);

  if (input.footer && input.footer.trim()) {
    components.push({
      type: 'FOOTER',
      text: input.footer.trim().slice(0, 60),
    });
  }

  if (input.buttons && input.buttons.length > 0) {
    const cleanButtons = input.buttons
      .filter((b) => b.text.trim())
      .slice(0, 3)
      .map((b) => {
        if (b.type === 'URL') {
          return {
            type: 'URL',
            text: b.text.trim().slice(0, 25),
            url: (b.url || 'https://example.com').trim(),
          };
        }
        if (b.type === 'PHONE_NUMBER') {
          return {
            type: 'PHONE_NUMBER',
            text: b.text.trim().slice(0, 25),
            phone_number: (b.phoneNumber || '+919800000000').trim(),
          };
        }
        return {
          type: 'QUICK_REPLY',
          text: b.text.trim().slice(0, 25),
        };
      });
    if (cleanButtons.length > 0) {
      components.push({ type: 'BUTTONS', buttons: cleanButtons });
    }
  }

  return {
    name: sanitizedName,
    category: input.category,
    language: input.language || 'en_US',
    components,
  };
}

// ============================================================================
// CUSTOM COLUMN-MAPPING IMPORT PARSER
// ============================================================================

export interface CustomColumnMapping {
  name: number;
  phone: number;
  email: number;
  company: number;
  tags: number;
  custom1: number;
  custom2: number;
  attachmentUrl: number;
  attachmentName: number;
  notes: number;
}

function splitDelimitedLine(line: string, delimiter: ',' | '\t'): string[] {
  if (delimiter === '\t') {
    return line.split('\t').map((c) => c.trim());
  }
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

/**
 * Parses CSV or tab-separated pasted Google Sheet text into headers + raw row matrix
 * and suggests automatic column mappings.
 */
export function parseRawTableForMapping(rawText: string): {
  headers: string[];
  rows: string[][];
  suggestedMapping: CustomColumnMapping;
} {
  const lines = (rawText || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return {
      headers: [],
      rows: [],
      suggestedMapping: {
        name: -1,
        phone: -1,
        email: -1,
        company: -1,
        tags: -1,
        custom1: -1,
        custom2: -1,
        attachmentUrl: -1,
        attachmentName: -1,
        notes: -1,
      },
    };
  }

  const delimiter: ',' | '\t' = lines[0].includes('\t') ? '\t' : ',';
  const headers = splitDelimitedLine(lines[0], delimiter);
  const rows = lines.slice(1).map((l) => splitDelimitedLine(l, delimiter));

  const normHeaders = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const find = (candidates: string[]) =>
    normHeaders.findIndex((h) => candidates.some((c) => h === c || h.includes(c)));

  return {
    headers,
    rows,
    suggestedMapping: {
      name: find(['name', 'customer', 'client', 'fullname']),
      phone: find(['phone', 'whatsapp', 'mobile', 'number']),
      email: find(['email', 'mail']),
      company: find(['company', 'business', 'firm', 'org']),
      tags: find(['tag', 'segment', 'group']),
      custom1: find(['custom1', 'order', 'receipt', 'invoice', 'plan', 'ref']),
      custom2: find(['custom2', 'city', 'amount', 'location', 'total']),
      attachmentUrl: find(['attachmenturl', 'pdfurl', 'receipturl', 'drive', 'fileurl', 'link']),
      attachmentName: find(['attachmentname', 'filename', 'pdfname']),
      notes: find(['note', 'remark', 'comment']),
    },
  };
}

export function mapCustomRowsToContacts(
  rows: string[][],
  mapping: CustomColumnMapping,
  defaultCountryCode = '91',
  nowIso = new Date().toISOString()
): { contacts: Contact[]; skippedRows: number } {
  if (mapping.phone < 0) {
    return { contacts: [], skippedRows: rows.length };
  }
  const seen = new Set<string>();
  const contacts: Contact[] = [];
  let skippedRows = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    const phone = normalizePhone(r[mapping.phone] || '', defaultCountryCode);
    if (!isValidPhone(phone) || seen.has(phone)) {
      skippedRows++;
      continue;
    }
    seen.add(phone);

    const rawUrl = mapping.attachmentUrl >= 0 ? (r[mapping.attachmentUrl] || '').trim() : '';
    const safeUrl = isSafeHttpsUrl(rawUrl) ? rawUrl : '';
    const rawTags = mapping.tags >= 0 ? r[mapping.tags] || '' : '';
    const tags = rawTags
      .split(/[;|,]/)
      .map((t) => t.trim())
      .filter(Boolean);

    contacts.push({
      id: `cnt-imp-${phone}-${i}`,
      name: (mapping.name >= 0 && r[mapping.name]) || `Contact ${phone.slice(-4)}`,
      phone,
      email: mapping.email >= 0 ? r[mapping.email] || '' : '',
      company: mapping.company >= 0 ? r[mapping.company] || '' : '',
      tags: tags.length > 0 ? tags : ['Imported'],
      status: 'open',
      assignedAgent: 'Sanket Rathod',
      custom1: mapping.custom1 >= 0 ? r[mapping.custom1] || '' : '',
      custom2: mapping.custom2 >= 0 ? r[mapping.custom2] || '' : '',
      attachmentUrl: safeUrl,
      attachmentName: mapping.attachmentName >= 0 ? r[mapping.attachmentName] || '' : '',
      notes: mapping.notes >= 0 ? r[mapping.notes] || '' : '',
      unreadCount: 0,
      lastMessagePreview: 'Imported via Custom Column Mapping',
      lastMessageAt: nowIso,
    });
  }
  return { contacts, skippedRows };
}

// ============================================================================
// EXTERNAL RECEIPT / TEMPLATE GOOGLE SHEETS MERGER
// ============================================================================

export function parseExternalSheetMessages(
  rows: string[][],
  source: ExternalSheetSource,
  defaultCountryCode = '91'
): ChatMessage[] {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0].map((h) => String(h || '').trim().toLowerCase());

  const resolveColIndex = (spec: string, fallbacks: string[]): number => {
    const clean = (spec || '').trim();
    if (/^[A-Za-z]{1,2}$/.test(clean)) {
      let col = 0;
      const upper = clean.toUpperCase();
      for (let i = 0; i < upper.length; i++) {
        col = col * 26 + (upper.charCodeAt(i) - 64);
      }
      return col - 1;
    }
    const lower = clean.toLowerCase();
    if (lower) {
      const exact = headers.indexOf(lower);
      if (exact >= 0) return exact;
    }
    return headers.findIndex((h) => fallbacks.some((f) => h.includes(f)));
  };

  const phoneIdx = resolveColIndex(source.colPhone, ['phone', 'whatsapp', 'mobile']);
  if (phoneIdx < 0) return [];

  const nameIdx = resolveColIndex(source.colName, ['name', 'customer', 'client']);
  const msgIdx = resolveColIndex(source.colMessage, ['message', 'body', 'text']);
  const waIdIdx = resolveColIndex(source.colWaId, ['wa_message_id', 'wamid', 'message_id']);
  const statusIdx = resolveColIndex(source.colStatus, ['status', 'delivery']);
  const tsIdx = resolveColIndex(source.colTimestamp, ['timestamp', 'sent_at', 'date', 'time']);
  const attIdx = resolveColIndex(source.colAttachmentUrl, ['receipt_url', 'pdf', 'attachment', 'link']);
  const receiptIdx = resolveColIndex(source.colReceiptNo, ['receipt', 'invoice', 'bill', 'ref']);

  const parsed: ChatMessage[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const phone = normalizePhone(String(r[phoneIdx] || ''), defaultCountryCode);
    if (!isValidPhone(phone)) continue;

    const rawStatus = statusIdx >= 0 ? String(r[statusIdx] || '').toLowerCase() : 'sent';
    let status: MessageDeliveryStatus = 'sent';
    if (rawStatus.includes('read') || rawStatus.includes('view')) status = 'read';
    else if (rawStatus.includes('deliver')) status = 'delivered';
    else if (rawStatus.includes('fail') || rawStatus.includes('error')) status = 'failed';
    else if (rawStatus.includes('queue') || rawStatus.includes('pend')) status = 'queued';

    const rawTs = tsIdx >= 0 ? String(r[tsIdx] || '').trim() : '';
    const parsedDate = rawTs ? new Date(rawTs) : new Date();
    const timestamp = Number.isNaN(parsedDate.getTime())
      ? new Date().toISOString()
      : parsedDate.toISOString();

    const waMessageId = waIdIdx >= 0 ? String(r[waIdIdx] || '').trim() : '';
    const receiptNo = receiptIdx >= 0 ? String(r[receiptIdx] || '').trim() : '';
    const attUrl = attIdx >= 0 ? String(r[attIdx] || '').trim() : '';
    const safeUrl = isSafeHttpsUrl(attUrl) ? attUrl : '';
    const contactName =
      (nameIdx >= 0 && String(r[nameIdx] || '').trim()) || `Customer ${phone.slice(-4)}`;
    const body =
      (msgIdx >= 0 && String(r[msgIdx] || '').trim()) ||
      `Template ${source.defaultTemplate}${receiptNo ? ` · Receipt ${receiptNo}` : ''} sent via ${source.label}`;

    parsed.push({
      id: waMessageId
        ? `ext-${waMessageId}`
        : `ext-${source.id}-r${i + 1}-${phone}`,
      contactId: `cnt-${phone}`,
      phone,
      contactName,
      direction: 'outbound',
      type: safeUrl ? inferAttachmentKind('', safeUrl) : 'template',
      body,
      attachment: safeUrl
        ? {
            id: `att-ext-${source.id}-${i}`,
            kind: inferAttachmentKind('', safeUrl),
            name: receiptNo ? `Receipt_${receiptNo}.pdf` : `${source.label}_Attachment.pdf`,
            mimeType: 'application/pdf',
            url: safeUrl,
          }
        : undefined,
      templateName: source.defaultTemplate || undefined,
      status,
      waMessageId: waMessageId || undefined,
      timestamp,
      sourceSheet: source.label,
      category: source.defaultCategory || 'UTILITY',
      deliveredAt: status === 'delivered' || status === 'read' ? timestamp : undefined,
      readAt: status === 'read' ? timestamp : undefined,
      billable: status !== 'failed' && source.defaultCategory !== 'SERVICE',
      receiptNo: receiptNo || undefined,
    });
  }
  return parsed;
}
