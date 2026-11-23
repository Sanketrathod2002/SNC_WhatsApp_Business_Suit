import { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  CheckCheck,
  Download,
  Eye,
  FileSpreadsheet,
  MessageSquareReply,
  RefreshCw,
  Send,
} from 'lucide-react';
import type {
  AnalyticsTimeframe,
  ChatMessage,
  ExternalSheetSource,
  NavSection,
} from '../types';
import { computeDashboardAnalytics, DEFAULT_PRICING_RATES } from '../utils/analyticsLogic';

interface DashboardViewProps {
  messages: ChatMessage[];
  externalSheets: ExternalSheetSource[];
  onNavigate: (section: NavSection) => void;
  onSyncExternalSheets: () => Promise<void>;
  onSyncLiveWorkspace: () => Promise<void>;
  isSyncingExternal: boolean;
  isSyncingLive: boolean;
}

export function DashboardView({
  messages,
  externalSheets,
  onNavigate,
  onSyncExternalSheets,
  onSyncLiveWorkspace,
  isSyncingExternal,
  isSyncingLive,
}: DashboardViewProps) {
  const [timeframe, setTimeframe] = useState<AnalyticsTimeframe>('daily');
  const [sourceFilter, setSourceFilter] = useState<string>('ALL');

  const analytics = useMemo(
    () =>
      computeDashboardAnalytics(messages, timeframe, DEFAULT_PRICING_RATES, {
        sourceFilter,
      }),
    [messages, timeframe, sourceFilter]
  );

  return (
    <div className="h-full overflow-y-auto bg-slate-50 px-4 py-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header & Primary Controls */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Delivery Overview
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Live sent, delivered, viewed, replied, and failed message totals.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Timeframe Segmented Control */}
            <div
              role="tablist"
              aria-label="Analytics timeframe"
              className="flex items-center gap-1 rounded-lg bg-slate-200/75 p-1"
            >
              {(['daily', 'weekly', 'monthly'] as AnalyticsTimeframe[]).map((tf) => (
                <button
                  key={tf}
                  type="button"
                  role="tab"
                  aria-selected={timeframe === tf}
                  onClick={() => setTimeframe(tf)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize whitespace-nowrap ${
                    timeframe === tf
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>

            {/* Source Sheet Filter */}
            <label className="sr-only" htmlFor="dashboard-source-filter">
              Filter by message source
            </label>
            <select
              id="dashboard-source-filter"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 focus:border-[#075E54] focus:outline-none"
            >
              <option value="ALL">All Sources (Web App + External Sheets)</option>
              {analytics.availableSources.map((src) => (
                <option key={src} value={src}>
                  {src}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#075E54] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#064c44] whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Custom Reports</span>
            </button>
          </div>
        </div>

        {/* Live Data Empty State Banner (Zero Dummy Data Policy) */}
        {messages.length === 0 && (
          <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-emerald-200 bg-emerald-50/70 px-5 py-4">
            <div>
              <p className="text-sm font-semibold text-emerald-950">
                No Messages Synced Yet
              </p>
              <p className="mt-0.5 text-xs text-emerald-900/80">
                Sync live data or send your first message to populate delivery metrics.
              </p>
            </div>
            <button
              type="button"
              disabled={isSyncingLive}
              onClick={() => void onSyncLiveWorkspace()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#075E54] px-4 py-2 text-xs font-semibold text-white hover:bg-[#064c44] disabled:opacity-50 whitespace-nowrap"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncingLive ? 'animate-spin' : ''}`} />
              <span>{isSyncingLive ? 'Syncing Live Data...' : 'Sync Live Data Now'}</span>
            </button>
          </section>
        )}

        {/* Strict 5-Metric Executive KPI Strip (Non-Interactive, Live Totals Only) */}
        <section
          aria-label="Live WhatsApp delivery totals"
          className="grid grid-cols-2 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white sm:grid-cols-3 lg:grid-cols-5 lg:divide-x lg:divide-y-0"
        >
          <div className="p-5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Total Sent</span>
              <Send className="h-4 w-4 text-[#075E54]" />
            </div>
            <p className="mt-2 font-mono text-3xl font-bold text-slate-900 tabular-nums">
              {analytics.totalSent.toLocaleString()}
            </p>
            <p className="mt-1.5 text-xs text-slate-500 tabular-nums">
              App {analytics.webAppSent} · Sheets {analytics.externalSheetSent}
            </p>
          </div>

          <div className="p-5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Delivered</span>
              <CheckCheck className="h-4 w-4 text-emerald-600" />
            </div>
            <p className="mt-2 font-mono text-3xl font-bold text-slate-900 tabular-nums">
              {analytics.totalDelivered.toLocaleString()}
            </p>
            <p className="mt-1.5 text-xs font-medium text-emerald-700 tabular-nums">
              {analytics.deliveryRate}% delivery rate
            </p>
          </div>

          <div className="p-5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Viewed / Read</span>
              <Eye className="h-4 w-4 text-sky-600" />
            </div>
            <p className="mt-2 font-mono text-3xl font-bold text-slate-900 tabular-nums">
              {analytics.totalRead.toLocaleString()}
            </p>
            <p className="mt-1.5 text-xs font-medium text-sky-700 tabular-nums">
              {analytics.readRate}% read rate
            </p>
          </div>

          <div className="p-5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Replied</span>
              <MessageSquareReply className="h-4 w-4 text-[#075E54]" />
            </div>
            <p className="mt-2 font-mono text-3xl font-bold text-slate-900 tabular-nums">
              {analytics.totalReplied.toLocaleString()}
            </p>
            <p className="mt-1.5 text-xs text-slate-500 tabular-nums">
              {analytics.replyRate}% reply · {analytics.totalInbound} inbound
            </p>
          </div>

          <div className="col-span-2 p-5 sm:col-span-1">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Failed</span>
              <AlertCircle className="h-4 w-4 text-red-600" />
            </div>
            <p className="mt-2 font-mono text-3xl font-bold text-slate-900 tabular-nums">
              {analytics.totalFailed.toLocaleString()}
            </p>
            <p className="mt-1.5 text-xs text-slate-500">
              {analytics.totalFailed > 0 ? 'Check Developer Retry Center' : 'Zero delivery failures'}
            </p>
          </div>
        </section>

        {/* Period-Wise Summary Table (Clean Non-Interactive Breakdown) */}
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-900">
              {timeframe === 'daily'
                ? 'Daily Activity Summary (Last 14 Days)'
                : timeframe === 'weekly'
                  ? 'Weekly Activity Summary (Last 8 Weeks)'
                  : 'Monthly Activity Summary (Last 6 Months)'}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Live delivery, read, and reply metrics synced from WhatsApp Business API.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 font-medium text-slate-500">
                  <th className="px-5 py-3">Period</th>
                  <th className="px-4 py-3 text-right">Total Sent</th>
                  <th className="px-4 py-3 text-right">Delivered</th>
                  <th className="px-4 py-3 text-right">Viewed / Read</th>
                  <th className="px-4 py-3 text-right">Replied</th>
                  <th className="px-5 py-3 text-right">Failed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {analytics.series.every(
                  (pt) =>
                    pt.sent === 0 &&
                    pt.delivered === 0 &&
                    pt.read === 0 &&
                    pt.replied === 0 &&
                    pt.failed === 0
                ) ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-xs text-slate-500">
                      No live WhatsApp activity recorded in this {timeframe} window yet.
                    </td>
                  </tr>
                ) : (
                  analytics.series
                    .filter(
                      (pt) =>
                        pt.sent > 0 ||
                        pt.delivered > 0 ||
                        pt.read > 0 ||
                        pt.replied > 0 ||
                        pt.failed > 0
                    )
                    .reverse()
                    .map((pt, idx) => (
                      <tr key={`${pt.label}-${idx}`}>
                        <td className="px-5 py-2.5 font-mono font-medium text-slate-900">
                          {pt.label}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-slate-900 tabular-nums">
                          {pt.sent}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-emerald-700 tabular-nums">
                          {pt.delivered}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-sky-700 tabular-nums">
                          {pt.read}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-slate-700 tabular-nums">
                          {pt.replied}
                        </td>
                        <td className="px-5 py-2.5 text-right font-mono text-red-600 tabular-nums">
                          {pt.failed}
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Bottom Tables: Connected External Receipt Sheets vs Web App + Pre-Approved Template Usage */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {/* Source Sheet Breakdown */}
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Web App & External Receipt Sources
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Automated external receipt dispatches included in live totals.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isSyncingExternal}
                  onClick={() => void onSyncExternalSheets()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isSyncingExternal ? 'animate-spin' : ''}`} />
                  <span>{isSyncingExternal ? 'Syncing...' : 'Sync Sheets'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('admin_dev')}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#075E54] hover:underline whitespace-nowrap"
                >
                  <span>Manage</span>
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 font-medium text-slate-500">
                    <th className="px-5 py-3">Source Sheet / Channel</th>
                    <th className="px-3 py-3 text-right">Sent</th>
                    <th className="px-3 py-3 text-right">Delivered</th>
                    <th className="px-3 py-3 text-right">Viewed / Read</th>
                    <th className="px-3 py-3 text-right">Replied</th>
                    <th className="px-5 py-3 text-right">Failed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {analytics.sourceBreakdown.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-xs text-slate-500">
                        No live messages logged yet. Click Sync Sheets or send a WhatsApp message to see real channel metrics.
                      </td>
                    </tr>
                  ) : (
                    analytics.sourceBreakdown.map((row) => (
                      <tr key={row.sourceSheet}>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-[#075E54]" />
                            <div>
                              <p className="font-medium text-slate-900">{row.sourceSheet}</p>
                              <p className="text-[11px] text-slate-500">
                                {row.isExternal ? 'External Receipt Source' : 'Primary Web App'}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right font-mono font-semibold text-slate-900 tabular-nums">
                          {row.sent}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-emerald-700 tabular-nums">
                          {row.delivered} ({row.deliveryRate}%)
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-sky-700 tabular-nums">
                          {row.read} ({row.readRate}%)
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-slate-700 tabular-nums">
                          {row.replied}
                        </td>
                        <td className="px-5 py-3 text-right font-mono text-red-600 tabular-nums">
                          {row.failed}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Pre-Approved Template Performance */}
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Pre-Approved Template Delivery
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Sent, delivered, and viewed counts across Meta pre-approved templates.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('templates')}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#075E54] hover:underline whitespace-nowrap"
              >
                <span>Templates</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 font-medium text-slate-500">
                    <th className="px-5 py-3">Template</th>
                    <th className="px-3 py-3">Category</th>
                    <th className="px-3 py-3 text-right">Sent</th>
                    <th className="px-3 py-3 text-right">Delivered</th>
                    <th className="px-5 py-3 text-right">Viewed / Read</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {analytics.templateBreakdown.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-8 text-center text-xs text-slate-500">
                        No pre-approved template dispatches recorded yet.
                      </td>
                    </tr>
                  ) : (
                    analytics.templateBreakdown.map((tpl) => (
                      <tr key={tpl.templateName}>
                        <td className="px-5 py-3 font-mono font-medium text-slate-900">
                          {tpl.templateName}
                        </td>
                        <td className="px-3 py-3 text-slate-600">{tpl.category}</td>
                        <td className="px-3 py-3 text-right font-mono font-semibold text-slate-900 tabular-nums">
                          {tpl.sent}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-emerald-700 tabular-nums">
                          {tpl.delivered}
                        </td>
                        <td className="px-5 py-3 text-right font-mono text-sky-700 tabular-nums">
                          {tpl.read} ({tpl.readRate}%)
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
