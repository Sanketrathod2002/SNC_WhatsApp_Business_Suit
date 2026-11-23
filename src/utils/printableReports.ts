import type { ChatMessage, PricingRatesConfig, WorkspaceConfig } from '../types';
import {
  type ReportColumnKey,
  REPORT_COLUMN_DEFINITIONS,
  buildCustomReportRows,
} from './analyticsLogic';

function escapeHtml(raw: unknown): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Opens a self-contained formatted HTML document in a new browser tab using a Blob URL
 * via an anchor element (avoids popup blockers and works cleanly on static hosts & iframes).
 */
export function openHtmlDocumentInNewTab(htmlContent: string): void {
  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

/**
 * Generates a professionally formatted A4 HTML + CSS printable/PDF report for Reports view.
 */
export function buildPrintableReportHtml(params: {
  businessName: string;
  messages: ChatMessage[];
  selectedColumns: ReportColumnKey[];
  pricing: PricingRatesConfig;
  filtersSummary: string;
}): string {
  const { businessName, messages, selectedColumns, pricing, filtersSummary } = params;
  const rows = buildCustomReportRows(messages, selectedColumns, pricing);
  const headerRow = rows[0] || REPORT_COLUMN_DEFINITIONS.filter((c) => selectedColumns.includes(c.key)).map((c) => c.label);
  const bodyRows = rows.slice(1);

  const outbound = messages.filter((m) => m.direction === 'outbound');
  const totalSent = outbound.filter((m) => m.status !== 'failed').length;
  const totalDelivered = outbound.filter((m) => m.status === 'delivered' || m.status === 'read').length;
  const totalRead = outbound.filter((m) => m.status === 'read').length;
  const totalReplied = messages.filter((m) => m.direction === 'inbound').length;
  const totalFailed = outbound.filter((m) => m.status === 'failed').length;
  const generatedAt = new Date().toLocaleString();

  const thHtml = headerRow.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const trHtml =
    bodyRows.length === 0
      ? `<tr><td colspan="${headerRow.length}" style="text-align:center;padding:24px;color:#64748b;">No records match the selected filters.</td></tr>`
      : bodyRows
          .map((row) => {
            const cells = row
              .map((cell) => {
                const lower = String(cell || '').toLowerCase();
                let cls = '';
                if (lower === 'read' || lower === 'viewed / read') cls = 'status-read';
                else if (lower === 'delivered') cls = 'status-delivered';
                else if (lower === 'failed') cls = 'status-failed';
                else if (lower === 'sent') cls = 'status-sent';
                return `<td class="${cls}">${escapeHtml(cell)}</td>`;
              })
              .join('');
            return `<tr>${cells}</tr>`;
          })
          .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(businessName)} — WhatsApp Report (${escapeHtml(new Date().toISOString().slice(0, 10))})</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #0f172a;
      background: #f1f5f9;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .toolbar {
      position: sticky;
      top: 0;
      z-index: 20;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 24px;
      background: #0f172a;
      color: #fff;
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.2);
    }
    .toolbar-title { font-size: 13px; font-weight: 600; }
    .toolbar-actions { display: flex; gap: 10px; }
    .btn {
      border: 0;
      border-radius: 8px;
      padding: 8px 16px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-primary { background: #075E54; color: #fff; }
    .btn-primary:hover { background: #064c44; }
    .btn-secondary { background: #334155; color: #fff; }
    .btn-secondary:hover { background: #475569; }
    .sheet {
      max-width: 1220px;
      margin: 20px auto 36px;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
      padding: 28px 32px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #075E54;
      padding-bottom: 14px;
      margin-bottom: 18px;
      gap: 16px;
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .logo {
      width: 40px;
      height: 40px;
      border-radius: 9px;
      background: #075E54;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 14px;
      letter-spacing: 0.5px;
    }
    h1 { margin: 0; font-size: 19px; color: #0f172a; }
    .subtitle { margin: 3px 0 0; font-size: 12px; color: #475569; }
    .meta { text-align: right; font-size: 11px; color: #475569; line-height: 1.5; }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 10px;
      margin-bottom: 18px;
    }
    .kpi {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 10px 12px;
      background: #f8fafc;
    }
    .kpi-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; font-weight: 600; }
    .kpi-val { font-size: 20px; font-weight: 700; margin-top: 4px; font-variant-numeric: tabular-nums; }
    .kpi-val.sent { color: #0f172a; }
    .kpi-val.delivered { color: #047857; }
    .kpi-val.read { color: #0369a1; }
    .kpi-val.replied { color: #334155; }
    .kpi-val.failed { color: #dc2626; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    th {
      background: #075E54;
      color: #fff;
      font-weight: 600;
      text-align: left;
      padding: 8px 10px;
      border: 1px solid #064c44;
      white-space: nowrap;
    }
    td {
      padding: 7px 10px;
      border: 1px solid #e2e8f0;
      vertical-align: top;
      word-break: break-word;
      max-width: 280px;
    }
    tbody tr:nth-child(even) { background: #f8fafc; }
    .status-read { color: #0369a1; font-weight: 700; text-transform: capitalize; }
    .status-delivered { color: #047857; font-weight: 700; text-transform: capitalize; }
    .status-sent { color: #334155; font-weight: 600; text-transform: capitalize; }
    .status-failed { color: #dc2626; font-weight: 700; text-transform: capitalize; }
    .footer {
      margin-top: 22px;
      padding-top: 12px;
      border-top: 1px solid #cbd5e1;
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: #64748b;
    }
    @media print {
      body { background: #fff; }
      .toolbar { display: none !important; }
      .sheet {
        max-width: none;
        margin: 0;
        padding: 0;
        box-shadow: none;
        border-radius: 0;
      }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="toolbar-title">Print &amp; PDF Preview — ${escapeHtml(bodyRows.length)} record(s)</div>
    <div class="toolbar-actions">
      <button type="button" class="btn btn-primary" onclick="window.print()">Print / Save as PDF</button>
      <button type="button" class="btn btn-secondary" onclick="window.close()">Close Tab</button>
    </div>
  </div>
  <div class="sheet">
    <div class="header">
      <div class="brand">
        <div class="logo">SNC</div>
        <div>
          <h1>${escapeHtml(businessName)} — WhatsApp Delivery Report</h1>
          <p class="subtitle">Filters: ${escapeHtml(filtersSummary)}</p>
        </div>
      </div>
      <div class="meta">
        <div><strong>Generated:</strong> ${escapeHtml(generatedAt)}</div>
        <div><strong>Total Records:</strong> ${escapeHtml(bodyRows.length)}</div>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">Total Sent</div><div class="kpi-val sent">${totalSent}</div></div>
      <div class="kpi"><div class="kpi-label">Delivered</div><div class="kpi-val delivered">${totalDelivered}</div></div>
      <div class="kpi"><div class="kpi-label">Viewed / Read</div><div class="kpi-val read">${totalRead}</div></div>
      <div class="kpi"><div class="kpi-label">Replied</div><div class="kpi-val replied">${totalReplied}</div></div>
      <div class="kpi"><div class="kpi-label">Failed</div><div class="kpi-val failed">${totalFailed}</div></div>
    </div>

    <table>
      <thead><tr>${thHtml}</tr></thead>
      <tbody>${trHtml}</tbody>
    </table>

    <div class="footer">
      <span>SNC WhatsApp Business Suite</span>
      <span>&copy; 2026 QuantumDynamics Data Solution. All Rights Reserved.</span>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Generates the complete, start-to-end Step-by-Step Setup & Deployment Manual (HTML -> Print/PDF)
 * exclusively available inside the password-protected Developer section.
 */
export function buildSetupGuidePdfHtml(config: WorkspaceConfig): string {
  const driveId = config.driveFolderId || 'Auto-detected from Apps Script Gateway';
  const generatedDate = new Date().toLocaleDateString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SNC WhatsApp Business Suite — Complete Step-by-Step Setup Guide</title>
  <style>
    @page { size: A4 portrait; margin: 14mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #0f172a;
      background: #f1f5f9;
      line-height: 1.55;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .toolbar {
      position: sticky;
      top: 0;
      z-index: 30;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 24px;
      background: #0f172a;
      color: #fff;
    }
    .toolbar-title { font-size: 13px; font-weight: 600; }
    .btn {
      border: 0;
      border-radius: 8px;
      padding: 8px 16px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      margin-left: 8px;
    }
    .btn-primary { background: #075E54; color: #fff; }
    .btn-secondary { background: #334155; color: #fff; }
    .doc {
      max-width: 860px;
      margin: 24px auto 40px;
      background: #fff;
      border-radius: 14px;
      padding: 36px 42px;
      box-shadow: 0 2px 10px rgba(15, 23, 42, 0.08);
    }
    .cover {
      border-bottom: 3px solid #075E54;
      padding-bottom: 20px;
      margin-bottom: 26px;
    }
    .badge {
      display: inline-block;
      background: #ecfdf5;
      color: #075E54;
      border: 1px solid #a7f3d0;
      font-size: 11px;
      font-weight: 700;
      padding: 3px 10px;
      border-radius: 6px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    h1 { margin: 10px 0 6px; font-size: 24px; color: #0f172a; }
    .lead { margin: 0; font-size: 13px; color: #475569; }
    .meta-strip {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      margin-top: 16px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 11px;
    }
    .step {
      margin-bottom: 22px;
      padding: 16px 18px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      page-break-inside: avoid;
    }
    .step-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
    }
    .step-num {
      width: 26px;
      height: 26px;
      border-radius: 7px;
      background: #075E54;
      color: #fff;
      font-size: 12px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    h2 { margin: 0; font-size: 15px; color: #0f172a; }
    p { margin: 6px 0; font-size: 12.5px; color: #334155; }
    ol, ul { margin: 6px 0 0; padding-left: 20px; font-size: 12.5px; color: #334155; }
    li { margin-bottom: 5px; }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11.5px;
      background: #f1f5f9;
      padding: 1px 5px;
      border-radius: 4px;
      color: #075E54;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      font-size: 11.5px;
    }
    th {
      background: #075E54;
      color: #fff;
      text-align: left;
      padding: 7px 10px;
      border: 1px solid #064c44;
    }
    td {
      padding: 7px 10px;
      border: 1px solid #e2e8f0;
      vertical-align: top;
    }
    tbody tr:nth-child(even) { background: #f8fafc; }
    .callout {
      margin-top: 10px;
      padding: 10px 12px;
      border-left: 3px solid #d97706;
      background: #fffbeb;
      font-size: 12px;
      color: #78350f;
    }
    .footer {
      margin-top: 28px;
      padding-top: 12px;
      border-top: 1px solid #cbd5e1;
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: #64748b;
    }
    @media print {
      body { background: #fff; }
      .toolbar { display: none !important; }
      .doc { max-width: none; margin: 0; padding: 0; box-shadow: none; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="toolbar-title">SNC WhatsApp Business Suite — Complete Setup Manual (PDF)</div>
    <div>
      <button type="button" class="btn btn-primary" onclick="window.print()">Save as PDF</button>
      <button type="button" class="btn btn-secondary" onclick="window.close()">Close</button>
    </div>
  </div>

  <div class="doc">
    <div class="cover">
      <span class="badge">Administrator Technical Manual</span>
      <h1>SNC WhatsApp Business Suite — Complete Setup Guide</h1>
      <p class="lead">
        End-to-end installation guide for running a 100% free serverless WhatsApp Business CRM using GitHub Pages / Netlify, Google Sheets, Google Drive, Google Apps Script, and Meta WhatsApp Cloud API v25.0.
      </p>
      <div class="meta-strip">
        <div><strong>Main Drive Folder ID:</strong><br /><code>${escapeHtml(driveId)}</code></div>
        <div><strong>Architecture:</strong><br />Static SPA + Dual Apps Script</div>
        <div><strong>Prepared:</strong><br />${escapeHtml(generatedDate)}</div>
      </div>
    </div>

    <div class="step">
      <div class="step-header"><div class="step-num">1</div><h2>Google Drive &amp; Master Google Sheet Preparation</h2></div>
      <ol>
        <li>Create or open your dedicated Google Drive folder for this workspace (its Folder ID is detected automatically when you connect your Apps Script Gateway URL).</li>
        <li>Create (or open your existing) Master Spreadsheet named <strong>SNC WhatsApp Business Master</strong> inside this folder and copy its Spreadsheet ID from the URL (<code>/spreadsheets/d/SPREADSHEET_ID/edit</code>).</li>
        <li>The auto-setup script automatically initializes all <strong>8 database tabs</strong>: <code>Contacts</code>, <code>Message_Logs</code>, <code>Campaigns</code>, <code>Templates</code>, <code>Config</code>, <code>Bulk_Queue</code>, <code>Connected_Sheets</code>, and <code>Shards_Registry</code>, plus the <code>Attachments</code> Drive subfolder for customer photos, PDFs, videos, and audio.</li>
      </ol>
    </div>

    <div class="step">
      <div class="step-header"><div class="step-num">2</div><h2>Meta Developers App &amp; Permanent System User Token</h2></div>
      <ol>
        <li>Log in to <strong>developers.facebook.com</strong> and open your Business App with the <strong>WhatsApp</strong> product enabled.</li>
        <li>Open <strong>WhatsApp &rarr; API Setup</strong> and note your <strong>Phone Number ID</strong> and <strong>WhatsApp Business Account ID (WABA ID)</strong>.</li>
        <li>In <strong>Meta Business Settings &rarr; Users &rarr; System Users</strong>, create an Admin System User, assign your WhatsApp Business Account &amp; App with Full Control, and generate a <strong>Never-Expiring Access Token</strong> with <code>whatsapp_business_messaging</code> and <code>whatsapp_business_management</code> permissions.</li>
        <li>At the top of Meta for Developers, switch <strong>App Mode</strong> from <strong>Development</strong> to <strong>Live</strong> so real customer messages and delivery receipts are delivered.</li>
      </ol>
    </div>

    <div class="step">
      <div class="step-header"><div class="step-num">3</div><h2>Deploy Master Gateway (Gateway_Code.gs) &amp; Script Properties</h2></div>
      <ol>
        <li>In your Master Google Sheet, click <strong>Extensions &rarr; Apps Script</strong>.</li>
        <li>Copy the complete code from <strong>Developer &rarr; Dual Apps Scripts &rarr; Gateway_Code.gs</strong> and paste it into <code>Code.gs</code>, then click <strong>Save</strong>.</li>
        <li>Open <strong>Project Settings (gear icon) &rarr; Script Properties</strong> and add these 7 keys (never hardcode secrets in GitHub or frontend code):</li>
      </ol>
      <table>
        <thead><tr><th>Script Property Key</th><th>Value to Enter</th></tr></thead>
        <tbody>
          <tr><td><code>DRIVE_FOLDER_ID</code></td><td><code>${escapeHtml(driveId)}</code></td></tr>
          <tr><td><code>SPREADSHEET_ID</code></td><td>Your Master Google Sheet ID</td></tr>
          <tr><td><code>ATTACHMENTS_FOLDER_ID</code></td><td>Auto-populated when you run <code>setupSncSheets</code></td></tr>
          <tr><td><code>WHATSAPP_ACCESS_TOKEN</code></td><td>Permanent Meta System User Token (<code>EAAG...</code>)</td></tr>
          <tr><td><code>WHATSAPP_PHONE_ID</code></td><td>Your Meta WhatsApp Phone Number ID</td></tr>
          <tr><td><code>WHATSAPP_WABA_ID</code></td><td>Your Meta WhatsApp Business Account ID</td></tr>
          <tr><td><code>WEBHOOK_VERIFY_TOKEN</code></td><td>Custom secret string (must match Meta Webhook Verify Token)</td></tr>
        </tbody>
      </table>
      <ol start="4" style="margin-top:10px;">
        <li>Run <code>setupSncSheets</code> once from the Apps Script toolbar and grant Google Drive &amp; Sheets permissions.</li>
        <li>Click <strong>Deploy &rarr; New deployment &rarr; Web app</strong>, set <strong>Execute as: Me</strong> and <strong>Who has access: Anyone</strong>, click <strong>Deploy</strong>, and copy the resulting <code>https://script.google.com/macros/s/.../exec</code> URL.</li>
        <li>When updating code later, always use <strong>Deploy &rarr; Manage deployments &rarr; Edit (pencil) &rarr; Version: New version &rarr; Deploy</strong> so your <code>/exec</code> URL stays unchanged.</li>
      </ol>
    </div>

    <div class="step">
      <div class="step-header"><div class="step-num">4</div><h2>Deploy Background Queue Worker (Worker_Code.gs)</h2></div>
      <ol>
        <li>In Apps Script, add a second script file named <code>Worker.gs</code> (or a separate Apps Script project sharing the same Script Properties) and paste <strong>Worker_Code.gs</strong>.</li>
        <li>Open <strong>Triggers (clock icon) &rarr; Add Trigger</strong>:
          <ul>
            <li>Function: <code>processBulkQueue</code> &rarr; Event source: <strong>Time-driven</strong> &rarr; <strong>Minutes timer &rarr; Every minute</strong>.</li>
            <li>Optional: <code>runDailyMaintenanceAndBackup</code> &rarr; <strong>Day timer &rarr; Midnight to 1am</strong> (auto-shards logs &gt; 30,000 rows and saves 14-day rolling Drive backups).</li>
          </ul>
        </li>
      </ol>
    </div>

    <div class="step">
      <div class="step-header"><div class="step-num">5</div><h2>Connect Web App &amp; Configure Meta Webhooks</h2></div>
      <ol>
        <li>Open the web application, unlock <strong>Settings</strong> (Password: <code>2026</code>), paste your <code>/exec</code> URL, and click <strong>Save &amp; Test Endpoint</strong>. All Drive Folder, Sheet, and Phone metadata sync automatically.</li>
        <li>In Meta Developers Portal, go to <strong>WhatsApp &rarr; Configuration</strong> (or <strong>Webhooks &rarr; WhatsApp Business Account</strong> — never <code>Webhooks &rarr; User</code>).</li>
        <li>Enter your <code>/exec</code> URL as <strong>Callback URL</strong> and your exact <code>WEBHOOK_VERIFY_TOKEN</code> as <strong>Verify token</strong>, then click <strong>Verify and save</strong>.</li>
        <li>Set all subscribed fields to one unified Graph API version (<strong>v25.0</strong>):
          <ul>
            <li><strong>Subscribe (Required/Recommended):</strong> <code>messages</code>, <code>message_template_status_update</code>, <code>message_template_components_update</code>, <code>message_template_quality_update</code>, <code>template_category_update</code>, <code>phone_number_quality_update</code>, <code>phone_number_name_update</code>, <code>account_alerts</code>, <code>account_update</code>, <code>account_review_update</code>, <code>business_capability_update</code>, <code>security</code>.</li>
            <li><strong>Leave Unsubscribed:</strong> <code>calls</code>, <code>flows</code>, <code>group_*</code>, <code>history</code>, <code>smb_*</code>, <code>tracking_events</code>, <code>user_preferences</code>, <code>payment_configuration_update</code>, <code>account_settings_update</code>, <code>automatic_events</code>, <code>business_status_update</code>, <code>business_username_updates</code>, <code>message_echoes</code>, <code>message_handovers</code>, <code>partner_solutions</code>.</li>
          </ul>
        </li>
      </ol>
      <div class="callout">
        <strong>Tip:</strong> Customer-sent photos, PDFs, videos, and audio are automatically downloaded from Meta Cloud API by <code>Gateway_Code.gs</code>, saved to your Google Drive <code>Attachments</code> folder with viewable links, and displayed directly inside Inbox.
      </div>
    </div>

    <div class="step">
      <div class="step-header"><div class="step-num">6</div><h2>External Receipt Google Sheets Connector</h2></div>
      <ol>
        <li>Open any external billing or receipt Google Sheet that sends WhatsApp messages via Apps Script.</li>
        <li>Copy <strong>External_Retailer_Receipt_Code.gs</strong> from <strong>Developer &rarr; Dual Apps Scripts</strong> (or the 20-line push helper in <strong>Reports &rarr; External Receipt Sheets</strong>) into that sheet&rsquo;s Apps Script project.</li>
        <li>Set <code>MASTER_GATEWAY_URL</code> in that sheet&rsquo;s Script Properties to your <code>/exec</code> URL. Every receipt sent from that sheet logs straight into your Master Dashboard and delivery tracker.</li>
      </ol>
    </div>

    <div class="step">
      <div class="step-header"><div class="step-num">7</div><h2>Free Static Frontend Deployment (GitHub Pages / Netlify)</h2></div>
      <ul>
        <li><strong>GitHub Pages:</strong> Push this repository to GitHub (<code>main</code> branch). Enable <strong>Settings &rarr; Pages &rarr; Source: GitHub Actions</strong>. The included <code>.github/workflows/deploy.yml</code> automatically builds <code>dist/</code> and publishes to <code>*.github.io</code> at $0 cost.</li>
        <li><strong>Netlify:</strong> Connect your GitHub repository or drag-and-drop the built <code>dist/</code> folder. <code>netlify.toml</code> automatically configures <code>npm run build</code>, publish directory <code>dist</code>, and SPA routing.</li>
      </ul>
    </div>

    <div class="step">
      <div class="step-header"><div class="step-num">8</div><h2>Authorized Operator Login &amp; Protected Admin Access</h2></div>
      <ul>
        <li><strong>WhatsApp OTP Sign-In:</strong> Restricted strictly to the 3 registered admin numbers: <code>+91 &bull;&bull;&bull;&bull;&bull;&bull;9575</code>, <code>+91 &bull;&bull;&bull;&bull;&bull;&bull;8679</code>, and <code>+91 &bull;&bull;&bull;&bull;&bull;&bull;5569</code>.</li>
        <li><strong>Protected Sections (Settings &amp; Developer):</strong> Both sections are locked by default and protected with Administrator Password <code>2026</code>. Always click <strong>Lock Section</strong> after making configuration changes.</li>
      </ul>
    </div>

    <div class="footer">
      <span>SNC WhatsApp Business Suite — Setup &amp; Deployment Manual</span>
      <span>&copy; 2026 QuantumDynamics Data Solution. All Rights Reserved.</span>
    </div>
  </div>
</body>
</html>`;
}
