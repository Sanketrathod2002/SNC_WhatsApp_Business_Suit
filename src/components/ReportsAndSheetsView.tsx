import { useMemo, useRef, useState } from 'react';
import {
  Download,
  FileSpreadsheet,
  Printer,
  Upload,
} from 'lucide-react';
import type {
  ChatMessage,
  ConfirmationRequest,
  Contact,
  ExternalSheetSource,
  MessageBillingCategory,
  MessageDeliveryStatus,
  PricingRatesConfig,
  WorkspaceConfig,
} from '../types';
import {
  REPORT_COLUMN_DEFINITIONS,
  type CustomColumnMapping,
  type ReportColumnKey,
  buildCustomReportCsv,
  buildCustomReportExcelXml,
  buildCustomReportRows,
  estimateMessageCost,
  filterReportMessages,
  formatCurrencyAmount,
  inferMessageCategory,
  mapCustomRowsToContacts,
  parseRawTableForMapping,
} from '../utils/analyticsLogic';
import {
  buildPrintableReportHtml,
  openHtmlDocumentInNewTab,
} from '../utils/printableReports';

interface ReportsAndSheetsViewProps {
  messages: ChatMessage[];
  externalSheets: ExternalSheetSource[];
  config: WorkspaceConfig;
  onImportContacts: (contacts: Contact[]) => void;
  onExportReportToSheet: (title: string, rows: string[][]) => Promise<string | null>;
  onRequestConfirmation: (req: ConfirmationRequest) => void;
}

export function ReportsAndSheetsView({
  messages,
  externalSheets,
  config,
  onImportContacts,
  onExportReportToSheet,
  onRequestConfirmation,
}: ReportsAndSheetsViewProps) {
  const [activeTab, setActiveTab] = useState<'reports' | 'custom-import'>('reports');

  // --- Tab 1: Custom Export Report Builder State ---
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [direction, setDirection] = useState<'all' | 'outbound' | 'inbound'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | MessageDeliveryStatus>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | MessageBillingCategory>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('ALL');
  const [templateFilter, setTemplateFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedColumns, setSelectedColumns] = useState<ReportColumnKey[]>(() =>
    REPORT_COLUMN_DEFINITIONS.filter((c) => c.defaultSelected).map((c) => c.key)
  );
  const [exportStatusMsg, setExportStatusMsg] = useState('');
  const [isExportingSheet, setIsExportingSheet] = useState(false);

  // --- Tab 2: Custom Column-Mapping Import Wizard State ---
  const [rawImportText, setRawImportText] = useState('');
  const [importMapping, setImportMapping] = useState<CustomColumnMapping | null>(null);
  const [importFeedback, setImportFeedback] = useState('');
  const importFileRef = useRef<HTMLInputElement | null>(null);

  const pricing: PricingRatesConfig = config.pricing;

  const availableSources = useMemo(() => {
    const s = new Set<string>(['SNC Web App']);
    for (const m of messages) {
      if (m.sourceSheet) s.add(m.sourceSheet);
    }
    for (const ext of externalSheets) {
      s.add(ext.label);
    }
    return Array.from(s);
  }, [messages, externalSheets]);

  const availableTemplates = useMemo(() => {
    const t = new Set<string>();
    for (const m of messages) {
      t.add(m.templateName || 'Direct Chat / Freeform');
    }
    return Array.from(t);
  }, [messages]);

  const filteredMessages = useMemo(
    () =>
      filterReportMessages(messages, {
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        direction,
        status: statusFilter,
        category: categoryFilter,
        sourceSheet: sourceFilter,
        templateName: templateFilter,
        searchQuery,
      }),
    [
      messages,
      dateFrom,
      dateTo,
      direction,
      statusFilter,
      categoryFilter,
      sourceFilter,
      templateFilter,
      searchQuery,
    ]
  );

  const filteredTotalSpend = useMemo(
    () => filteredMessages.reduce((acc, m) => acc + estimateMessageCost(m, pricing), 0),
    [filteredMessages, pricing]
  );

  const toggleColumn = (key: ReportColumnKey) => {
    setSelectedColumns((prev) =>
      prev.includes(key)
        ? prev.length > 1
          ? prev.filter((k) => k !== key)
          : prev
        : [...prev, key]
    );
  };

  const triggerDownload = (content: string, fileName: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadCsv = () => {
    const csv = buildCustomReportCsv(filteredMessages, selectedColumns, pricing);
    triggerDownload(
      csv,
      `SNC_WhatsApp_Report_${new Date().toISOString().slice(0, 10)}.csv`,
      'text/csv;charset=utf-8'
    );
    setExportStatusMsg(`Downloaded CSV with ${filteredMessages.length} rows.`);
  };

  const handleDownloadExcel = () => {
    const xml = buildCustomReportExcelXml(filteredMessages, selectedColumns, pricing);
    triggerDownload(
      xml,
      `SNC_WhatsApp_Report_${new Date().toISOString().slice(0, 10)}.xls`,
      'application/vnd.ms-excel;charset=utf-8'
    );
    setExportStatusMsg(`Downloaded Excel (.xls) workbook with ${filteredMessages.length} rows.`);
  };

  const handleOpenPrintableReport = () => {
    const summaryParts: string[] = [];
    if (dateFrom || dateTo) summaryParts.push(`Date: ${dateFrom || 'Start'} to ${dateTo || 'Today'}`);
    if (direction !== 'all') summaryParts.push(`Direction: ${direction}`);
    if (statusFilter !== 'all') summaryParts.push(`Status: ${statusFilter}`);
    if (categoryFilter !== 'all') summaryParts.push(`Category: ${categoryFilter}`);
    if (sourceFilter !== 'ALL') summaryParts.push(`Source: ${sourceFilter}`);
    if (templateFilter !== 'ALL') summaryParts.push(`Template: ${templateFilter}`);
    if (searchQuery.trim()) summaryParts.push(`Search: "${searchQuery.trim()}"`);

    const html = buildPrintableReportHtml({
      businessName: config.businessName || 'SNC WhatsApp Business',
      messages: filteredMessages,
      selectedColumns,
      pricing,
      filtersSummary: summaryParts.length > 0 ? summaryParts.join(' · ') : 'All Records',
    });
    openHtmlDocumentInNewTab(html);
    setExportStatusMsg(`Opened formatted Print / PDF report (${filteredMessages.length} rows) in a new tab.`);
  };

  const handleExportToGoogleSheetClick = () => {
    const title = `SNC WhatsApp Report ${new Date().toISOString().slice(0, 10)}`;
    const rows = buildCustomReportRows(filteredMessages, selectedColumns, pricing);
    onRequestConfirmation({
      title: 'Export Custom Report to Google Sheets?',
      description: `Creates a new formatted report sheet "${title}" with ${filteredMessages.length} filtered rows.`,
      details: [
        `Rows: ${filteredMessages.length}`,
        `Columns: ${selectedColumns.length}`,
        `Estimated Spend in Report: ${formatCurrencyAmount(filteredTotalSpend, pricing.currency)}`,
      ],
      confirmLabel: 'Create Sheet Report',
      onConfirm: async () => {
        setIsExportingSheet(true);
        try {
          const url = await onExportReportToSheet(title, rows);
          if (url) {
            setExportStatusMsg(`Saved report sheet: ${url}`);
          }
        } finally {
          setIsExportingSheet(false);
        }
      },
    });
  };

  // --- Custom Column-Mapping Import Wizard ---
  const parsedImport = useMemo(() => parseRawTableForMapping(rawImportText), [rawImportText]);
  const activeMapping = importMapping || parsedImport.suggestedMapping;

  const handleImportFileRead = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setRawImportText(text);
    setImportMapping(null);
    setImportFeedback('');
  };

  const handleRunCustomMappedImport = () => {
    if (parsedImport.rows.length === 0) {
      setImportFeedback('Paste or upload a CSV/Sheet table with at least 1 data row.');
      return;
    }
    if (activeMapping.phone < 0) {
      setImportFeedback('Map the WhatsApp Phone column before importing.');
      return;
    }
    const res = mapCustomRowsToContacts(
      parsedImport.rows,
      activeMapping,
      config.defaultCountryCode
    );
    if (res.contacts.length === 0) {
      setImportFeedback('No valid WhatsApp phone numbers found in the mapped Phone column.');
      return;
    }
    onImportContacts(res.contacts);
    setImportFeedback(
      `Imported ${res.contacts.length} contact(s) into CRM (${res.skippedRows} skipped/duplicate).`
    );
    setRawImportText('');
    setImportMapping(null);
  };

  return (
    <div className="h-full overflow-y-auto bg-slate-50 px-4 py-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header & Section Tabs */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Reports & Import
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Filter message logs, export CSV/Excel/PDF reports, and map custom contact imports.
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Reports and import sections"
            className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-200/75 p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'reports'}
              onClick={() => setActiveTab('reports')}
              className={`rounded-md px-3.5 py-1.5 text-xs font-medium whitespace-nowrap ${
                activeTab === 'reports'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Export Reports ({filteredMessages.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'custom-import'}
              onClick={() => setActiveTab('custom-import')}
              className={`rounded-md px-3.5 py-1.5 text-xs font-medium whitespace-nowrap ${
                activeTab === 'custom-import'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Custom Column Import
            </button>
          </div>
        </div>

        {/* =================================================================== */}
        {/* TAB 1: CUSTOM EXPORT REPORT BUILDER                                 */}
        {/* =================================================================== */}
        {activeTab === 'reports' && (
          <div className="space-y-5">
            <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    Filter & Customize Report Columns
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Matching {filteredMessages.length} records · Estimated spend:{' '}
                    <span className="font-mono font-semibold text-slate-800 tabular-nums">
                      {formatCurrencyAmount(filteredTotalSpend, pricing.currency)}
                    </span>
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadCsv}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Export CSV</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadExcel}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5 text-[#075E54]" />
                    <span>Export Excel (.xls)</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenPrintableReport}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    <Printer className="h-3.5 w-3.5 text-[#075E54]" />
                    <span>Print / PDF</span>
                  </button>
                  <button
                    type="button"
                    disabled={isExportingSheet || !config.appsScriptWebAppUrl}
                    onClick={handleExportToGoogleSheetClick}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#075E54] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#064c44] disabled:opacity-50 whitespace-nowrap"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                    <span>{isExportingSheet ? 'Saving...' : 'Save to Sheet'}</span>
                  </button>
                </div>
              </div>

              {/* Filters Grid */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                <div>
                  <label htmlFor="rep-from" className="block text-[11px] font-medium text-slate-600">
                    From Date
                  </label>
                  <input
                    id="rep-from"
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-[#075E54] focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="rep-to" className="block text-[11px] font-medium text-slate-600">
                    To Date
                  </label>
                  <input
                    id="rep-to"
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-[#075E54] focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="rep-dir" className="block text-[11px] font-medium text-slate-600">
                    Direction
                  </label>
                  <select
                    id="rep-dir"
                    value={direction}
                    onChange={(e) =>
                      setDirection(e.target.value as 'all' | 'outbound' | 'inbound')
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:border-[#075E54] focus:outline-none"
                  >
                    <option value="all">All</option>
                    <option value="outbound">Outbound</option>
                    <option value="inbound">Inbound</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="rep-status" className="block text-[11px] font-medium text-slate-600">
                    Status
                  </label>
                  <select
                    id="rep-status"
                    value={statusFilter}
                    onChange={(e) =>
                      setStatusFilter(e.target.value as 'all' | MessageDeliveryStatus)
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:border-[#075E54] focus:outline-none"
                  >
                    <option value="all">All Statuses</option>
                    <option value="sent">Sent</option>
                    <option value="delivered">Delivered</option>
                    <option value="read">Viewed / Read</option>
                    <option value="failed">Failed</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="rep-cat" className="block text-[11px] font-medium text-slate-600">
                    Category
                  </label>
                  <select
                    id="rep-cat"
                    value={categoryFilter}
                    onChange={(e) =>
                      setCategoryFilter(e.target.value as 'all' | MessageBillingCategory)
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:border-[#075E54] focus:outline-none"
                  >
                    <option value="all">All Categories</option>
                    <option value="MARKETING">Marketing</option>
                    <option value="UTILITY">Utility</option>
                    <option value="AUTHENTICATION">Authentication</option>
                    <option value="SERVICE">Service (Free)</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="rep-source" className="block text-[11px] font-medium text-slate-600">
                    Source
                  </label>
                  <select
                    id="rep-source"
                    value={sourceFilter}
                    onChange={(e) => setSourceFilter(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:border-[#075E54] focus:outline-none"
                  >
                    <option value="ALL">All Sources</option>
                    {availableSources.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="rep-tpl" className="block text-[11px] font-medium text-slate-600">
                    Template
                  </label>
                  <select
                    id="rep-tpl"
                    value={templateFilter}
                    onChange={(e) => setTemplateFilter(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:border-[#075E54] focus:outline-none"
                  >
                    <option value="ALL">All Templates</option>
                    {availableTemplates.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                <input
                  type="search"
                  aria-label="Search report records"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search contact, phone, receipt no., template, or message..."
                  className="w-full max-w-md rounded-lg border border-slate-200 px-3 py-1.5 text-xs focus:border-[#075E54] focus:outline-none"
                />
                {exportStatusMsg && (
                  <p role="status" className="text-xs font-medium text-emerald-700">
                    {exportStatusMsg}
                  </p>
                )}
              </div>

              {/* Selectable Export Columns */}
              <div className="border-t border-slate-100 pt-3">
                <p className="text-[11px] font-semibold text-slate-600">
                  Included Export Columns ({selectedColumns.length} selected)
                </p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                  {REPORT_COLUMN_DEFINITIONS.map((col) => (
                    <label
                      key={col.key}
                      className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedColumns.includes(col.key)}
                        onChange={() => toggleColumn(col.key)}
                        className="h-3.5 w-3.5 rounded border-slate-300 accent-[#075E54]"
                      />
                      <span>{col.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </section>

            {/* Filtered Report Preview Table */}
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 font-medium text-slate-500">
                      <th className="px-4 py-3">Date / Time</th>
                      <th className="px-3 py-3">Source</th>
                      <th className="px-3 py-3">Recipient</th>
                      <th className="px-3 py-3">Template / Receipt</th>
                      <th className="px-3 py-3">Category</th>
                      <th className="px-3 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Spend</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredMessages.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-5 py-8 text-center text-slate-500">
                          No message logs match your current filter criteria.
                        </td>
                      </tr>
                    ) : (
                      filteredMessages.slice(0, 100).map((m) => (
                        <tr key={m.id} className="hover:bg-slate-50/70">
                          <td className="px-4 py-2.5 font-mono text-[11px] text-slate-600 tabular-nums whitespace-nowrap">
                            {new Date(m.timestamp).toLocaleString()}
                          </td>
                          <td className="px-3 py-2.5 font-medium text-slate-800">
                            {m.sourceSheet || 'SNC Web App'}
                          </td>
                          <td className="px-3 py-2.5">
                            <p className="font-medium text-slate-900">{m.contactName}</p>
                            <p className="font-mono text-[11px] text-slate-500 tabular-nums">
                              +{m.phone}
                            </p>
                          </td>
                          <td className="px-3 py-2.5">
                            <p className="font-mono text-slate-800">
                              {m.templateName || (m.direction === 'inbound' ? 'Inbound Reply' : 'Direct Chat')}
                            </p>
                            {m.receiptNo && (
                              <p className="text-[11px] text-slate-500">Receipt: {m.receiptNo}</p>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-slate-600">
                            {inferMessageCategory(m)}
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className={`font-medium capitalize ${
                                m.status === 'read'
                                  ? 'text-sky-700'
                                  : m.status === 'delivered'
                                    ? 'text-emerald-700'
                                    : m.status === 'failed'
                                      ? 'text-red-600'
                                      : 'text-slate-700'
                              }`}
                            >
                              {m.status === 'read' ? 'Viewed / Read' : m.status}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-slate-900 tabular-nums">
                            {formatCurrencyAmount(estimateMessageCost(m, pricing), pricing.currency)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 2: CUSTOM COLUMN-MAPPING IMPORT WIZARD                          */}
        {/* =================================================================== */}
        {activeTab === 'custom-import' && (
          <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Custom Column-Mapping Import Wizard
                </h2>
                <p className="mt-1 text-xs text-slate-600">
                  Upload any CSV or paste rows copied from spreadsheets — then map any column order to Name, WhatsApp Phone, Custom Merge Fields, and Per-Contact PDF Attachment URLs.
                </p>
              </div>
              <div>
                <input
                  ref={importFileRef}
                  type="file"
                  accept=".csv,text/csv,.tsv,text/plain"
                  onChange={(e) => void handleImportFileRead(e.target.files?.[0])}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => importFileRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>Upload CSV / TSV File</span>
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="custom-import-paste" className="block text-xs font-medium text-slate-700">
                Paste CSV or Spreadsheet Rows (first row = headers)
              </label>
              <textarea
                id="custom-import-paste"
                rows={5}
                value={rawImportText}
                onChange={(e) => {
                  setRawImportText(e.target.value);
                  setImportMapping(null);
                }}
                placeholder={`Customer Name,Mobile Number,Company,Invoice Ref,City,Receipt Link\nSneha Kulkarni,9822334455,Kulkarni Foods,INV-901,Pune,https://drive.google.com/uc?id=sample1`}
                className="mt-1.5 w-full rounded-lg border border-slate-200 p-3 font-mono text-xs focus:border-[#075E54] focus:outline-none"
              />
            </div>

            {parsedImport.headers.length > 0 && (
              <div className="space-y-4 border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-slate-900">
                  Map Detected Columns ({parsedImport.headers.length} columns · {parsedImport.rows.length} data rows)
                </p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {(
                    [
                      ['phone', 'WhatsApp Phone *'],
                      ['name', 'Contact Name'],
                      ['company', 'Company'],
                      ['custom1', 'Custom 1 / Receipt Ref'],
                      ['custom2', 'Custom 2 / City / Amt'],
                      ['attachmentUrl', 'Per-Contact PDF URL'],
                      ['attachmentName', 'Attachment Filename'],
                      ['email', 'Email'],
                      ['tags', 'Tags / Segment'],
                      ['notes', 'Notes'],
                    ] as Array<[keyof CustomColumnMapping, string]>
                  ).map(([field, label]) => (
                    <div key={field}>
                      <label className="block text-[11px] font-medium text-slate-600">
                        {label}
                      </label>
                      <select
                        value={activeMapping[field]}
                        onChange={(e) =>
                          setImportMapping({
                            ...activeMapping,
                            [field]: Number(e.target.value),
                          })
                        }
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:border-[#075E54] focus:outline-none"
                      >
                        <option value={-1}>— Skip —</option>
                        {parsedImport.headers.map((h, idx) => (
                          <option key={`${field}-${idx}`} value={idx}>
                            {h || `Column ${idx + 1}`}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between pt-2">
                  <p className="text-xs text-slate-500">
                    Phone numbers automatically normalize to E.164 (+{config.defaultCountryCode}).
                  </p>
                  <button
                    type="button"
                    onClick={handleRunCustomMappedImport}
                    className="rounded-lg bg-[#075E54] px-4 py-2 text-xs font-medium text-white hover:bg-[#064c44]"
                  >
                    Import {parsedImport.rows.length} Row(s) to CRM
                  </button>
                </div>
              </div>
            )}

            {importFeedback && (
              <p role="status" className="text-xs font-medium text-emerald-700">
                {importFeedback}
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
