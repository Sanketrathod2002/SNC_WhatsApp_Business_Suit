import { useState } from 'react';
import {
  CheckCircle2,
  Download,
  KeyRound,
  Lock,
  MessageSquare,
  RefreshCw,
  Server,
  ShieldCheck,
  Unlock,
} from 'lucide-react';
import type { AuthSession, WorkspaceConfig } from '../types';
import { AUTHORIZED_OPERATORS } from '../data/seedData';
import { verifySecurityPinHash } from '../utils/whatsappLogic';
import {
  pingAppsScriptWebApp,
  sendWhatsAppOtpViaGateway,
  verifyWhatsAppOtpViaGateway,
} from '../services/whatsappApi';
import {
  generateGatewayAppsScriptCode,
  generateWorkerAppsScriptCode,
} from '../utils/appsScriptTemplate';

interface LoginGateProps {
  config: WorkspaceConfig;
  onUpdateConfig: (patch: Partial<WorkspaceConfig>) => void;
  onAuthenticated: (session: AuthSession) => void;
}

export function LoginGate({
  config,
  onUpdateConfig,
  onAuthenticated,
}: LoginGateProps) {
  const [selectedOperatorId, setSelectedOperatorId] = useState<string>(
    AUTHORIZED_OPERATORS[0].id
  );

  const [otpStep, setOtpStep] = useState<'phone' | 'verify'>('phone');
  const [otpCode, setOtpCode] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpStatus, setOtpStatus] = useState<{ type: 'info' | 'error' | 'success'; text: string } | null>(
    null
  );

  const [showServerPanel, setShowServerPanel] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinUnlocked, setPinUnlocked] = useState(false);
  const [pinError, setPinError] = useState('');
  const [gatewayUrlDraft, setGatewayUrlDraft] = useState(config.appsScriptWebAppUrl);
  const [apiKeyDraft, setApiKeyDraft] = useState(config.appsScriptApiKey);
  const [serverMsg, setServerMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [busyAction, setBusyAction] = useState<'ping' | null>(null);

  const activeOperator =
    AUTHORIZED_OPERATORS.find((op) => op.id === selectedOperatorId) ||
    AUTHORIZED_OPERATORS[0];

  const targetPhone = activeOperator.phone;

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setOtpStatus(null);
    if (!targetPhone || targetPhone.length < 10) {
      setOtpStatus({ type: 'error', text: 'Select an authorized admin account to continue.' });
      return;
    }
    setOtpLoading(true);
    try {
      const res = await sendWhatsAppOtpViaGateway(
        {
          appsScriptWebAppUrl: config.appsScriptWebAppUrl,
          appsScriptApiKey: config.appsScriptApiKey,
        },
        targetPhone
      );
      if (res.ok) {
        setOtpStep('verify');
        setOtpStatus({
          type: 'success',
          text: `6-digit WhatsApp OTP dispatched to ${res.maskedPhone || activeOperator.maskedPhone}. Valid for 5 minutes.`,
        });
      } else {
        setOtpStatus({
          type: 'error',
          text:
            res.error ||
            'Gateway did not return an OTP confirmation. Ensure Gateway_Code.gs is deployed or open Configure Server below.',
        });
      }
    } finally {
      setOtpLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setOtpStatus(null);
    if (!/^\d{6}$/.test(otpCode.trim())) {
      setOtpStatus({ type: 'error', text: 'Enter the 6-digit code sent to your WhatsApp.' });
      return;
    }
    setOtpLoading(true);
    try {
      const res = await verifyWhatsAppOtpViaGateway(
        {
          appsScriptWebAppUrl: config.appsScriptWebAppUrl,
          appsScriptApiKey: config.appsScriptApiKey,
        },
        targetPhone,
        otpCode.trim()
      );
      if (res.ok && res.sessionToken) {
        onAuthenticated({
          username: res.user?.phone || targetPhone,
          name: res.user?.name || res.name || activeOperator.name,
          role: res.user?.role || res.role || activeOperator.role,
          phone: res.user?.phone || targetPhone,
          sessionToken: res.sessionToken,
          authenticatedAt: new Date().toISOString(),
          mode: 'whatsapp-otp',
        });
      } else {
        setOtpStatus({
          type: 'error',
          text: res.error || 'Invalid or expired OTP. Request a new code.',
        });
      }
    } finally {
      setOtpLoading(false);
    }
  };

  const handleUnlockServerConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError('');
    const valid = await verifySecurityPinHash(pinInput);
    if (valid) {
      setPinUnlocked(true);
      setPinInput('');
    } else {
      setPinError('Security verification PIN did not match.');
    }
  };

  const handleSaveAndPing = async () => {
    setServerMsg(null);
    const cleanUrl = gatewayUrlDraft.trim();
    if (!cleanUrl) {
      setServerMsg({ type: 'err', text: 'Paste your deployed Master Gateway Web App (/exec) URL first.' });
      return;
    }
    setBusyAction('ping');
    try {
      const res = await pingAppsScriptWebApp(cleanUrl);
      if (res.ok) {
        const d = res.data || {};
        const fetchedFolderId = typeof d.driveFolderId === 'string' ? d.driveFolderId : '';
        const fetchedFolderUrl =
          typeof d.driveFolderUrl === 'string' && d.driveFolderUrl
            ? d.driveFolderUrl
            : fetchedFolderId
              ? `https://drive.google.com/drive/folders/${fetchedFolderId}`
              : '';
        onUpdateConfig({
          appsScriptWebAppUrl: cleanUrl,
          appsScriptApiKey: apiKeyDraft.trim(),
          spreadsheetId: typeof d.spreadsheetId === 'string' ? d.spreadsheetId : '',
          spreadsheetUrl: typeof d.spreadsheetUrl === 'string' ? d.spreadsheetUrl : '',
          driveFolderId: fetchedFolderId,
          driveFolderUrl: fetchedFolderUrl,
          attachmentsFolderId:
            typeof d.attachmentsFolderId === 'string' ? d.attachmentsFolderId : '',
          phoneId: typeof d.phoneId === 'string' ? d.phoneId : '',
          wabaId: typeof d.wabaId === 'string' ? d.wabaId : '',
          displayPhoneNumber:
            typeof d.displayPhoneNumber === 'string' ? d.displayPhoneNumber : '',
          businessName:
            typeof d.businessName === 'string' && d.businessName
              ? d.businessName
              : config.businessName,
        });
        setServerMsg({
          type: 'ok',
          text: `Gateway reachable (HTTP ${res.statusCode || 200}). Verify your 6-digit WhatsApp OTP above to unlock workspace & sync Drive Folder and Master Sheet IDs.`,
        });
      } else {
        setServerMsg({
          type: 'err',
          text: res.error || 'Unable to reach Gateway endpoint.',
        });
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleDownloadScript = (kind: 'gateway' | 'worker') => {
    const content =
      kind === 'gateway'
        ? generateGatewayAppsScriptCode({
            spreadsheetId: config.spreadsheetId,
            folderId: config.driveFolderId,
            businessName: config.businessName,
            webhookVerifyToken: config.webhookVerifyToken,
            wabaId: config.wabaId,
            phoneId: config.phoneId,
          })
        : generateWorkerAppsScriptCode({
            spreadsheetId: config.spreadsheetId,
            folderId: config.driveFolderId,
            businessName: config.businessName,
          });
    const blob = new Blob([content], { type: 'text/javascript;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = kind === 'gateway' ? 'Gateway_Code.gs' : 'Worker_Code.gs';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-lg space-y-5">
        {/* Main Brand Card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#075E54] text-white shadow-xs">
              <MessageSquare className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold tracking-tight text-slate-900">
                SNC WhatsApp Business Suite
              </h1>
              <p className="truncate text-xs text-slate-500">
                {config.businessName}
              </p>
            </div>
          </div>

          <div className="mt-6 rounded-xl border border-emerald-200/80 bg-emerald-50/70 px-4 py-3">
            <div className="flex items-start gap-2.5 text-xs text-emerald-950">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#075E54]" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">WhatsApp OTP Authentication</p>
                  {config.appsScriptWebAppUrl ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                      <CheckCircle2 className="h-3 w-3" />
                      Gateway Connected
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-emerald-900/90">
                  Select an authorized admin account below to receive a 6-digit verification code on WhatsApp.
                </p>
              </div>
            </div>
          </div>

          {otpStep === 'phone' ? (
            <form onSubmit={handleRequestOtp} className="mt-6 space-y-4">
              <div>
                <label
                  htmlFor="login-admin-select"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Select Authorized Admin Number
                </label>
                <select
                  id="login-admin-select"
                  value={selectedOperatorId}
                  onChange={(e) => {
                    setSelectedOperatorId(e.target.value);
                    setOtpStatus(null);
                  }}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium text-slate-900 focus:border-[#075E54] focus:outline-none"
                >
                  {AUTHORIZED_OPERATORS.map((op) => (
                    <option key={op.id} value={op.id}>
                      {op.name} ({op.maskedPhone}) — {op.role}
                    </option>
                  ))}
                </select>

                <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {AUTHORIZED_OPERATORS.map((op) => {
                    const selected = selectedOperatorId === op.id;
                    return (
                      <button
                        key={op.id}
                        type="button"
                        onClick={() => {
                          setSelectedOperatorId(op.id);
                          setOtpStatus(null);
                        }}
                        className={`flex flex-col items-start rounded-xl border p-2.5 text-left transition-colors ${
                          selected
                            ? 'border-[#075E54] bg-emerald-50/60'
                            : 'border-slate-200 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <span className="w-full truncate text-xs font-semibold text-slate-900">
                          {op.name}
                        </span>
                        <span className="mt-1 font-mono text-[11px] text-slate-500">
                          {op.maskedPhone}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {otpStatus && (
                <div
                  role="status"
                  className={`rounded-lg border px-3.5 py-2.5 text-xs ${
                    otpStatus.type === 'error'
                      ? 'border-red-200 bg-red-50 text-red-800'
                      : otpStatus.type === 'success'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                        : 'border-slate-200 bg-slate-50 text-slate-700'
                  }`}
                >
                  {otpStatus.text}
                </div>
              )}

              <button
                type="submit"
                disabled={otpLoading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#075E54] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#064c44] disabled:opacity-60"
              >
                {otpLoading ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <KeyRound className="h-4 w-4" />
                )}
                <span>
                  {otpLoading ? 'Dispatching WhatsApp OTP...' : 'Send 6-Digit WhatsApp OTP'}
                </span>
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="mt-6 space-y-4">
              <div>
                <label
                  htmlFor="login-otp-input"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Enter 6-Digit WhatsApp Verification Code
                </label>
                <input
                  id="login-otp-input"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6-digit code"
                  className="mt-1.5 w-full rounded-xl border border-slate-300 px-4 py-3 text-center font-mono text-xl font-bold tracking-[0.4em] text-slate-900 focus:border-[#075E54] focus:outline-none"
                />
              </div>

              {otpStatus && (
                <div
                  role="status"
                  className={`rounded-lg border px-3.5 py-2.5 text-xs ${
                    otpStatus.type === 'error'
                      ? 'border-red-200 bg-red-50 text-red-800'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  }`}
                >
                  {otpStatus.text}
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setOtpStep('phone');
                    setOtpCode('');
                    setOtpStatus(null);
                  }}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={otpLoading}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#075E54] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#064c44] disabled:opacity-60"
                >
                  {otpLoading ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  <span>{otpLoading ? 'Verifying...' : 'Verify & Open Workspace'}</span>
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Configure Server & Admin Setup Panel (PIN Protected) */}
        <div className="rounded-2xl border border-slate-200 bg-white">
          <button
            type="button"
            onClick={() => setShowServerPanel((v) => !v)}
            className="flex w-full items-center justify-between px-5 py-3.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 rounded-2xl"
          >
            <span className="inline-flex items-center gap-2">
              <Server className="h-4 w-4 text-[#075E54]" />
              <span>Configure Server & Initial Gateway Setup</span>
            </span>
            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-500">
              {pinUnlocked ? (
                <>
                  <Unlock className="h-3.5 w-3.5 text-emerald-600" />
                  <span>Unlocked</span>
                </>
              ) : (
                <>
                  <Lock className="h-3.5 w-3.5 text-slate-400" />
                  <span>Admin PIN</span>
                </>
              )}
            </span>
          </button>

          {showServerPanel && (
            <div className="border-t border-slate-200 px-5 py-4">
              {!pinUnlocked ? (
                <form onSubmit={handleUnlockServerConfig} className="space-y-3">
                  <p className="text-xs text-slate-600">
                    Enter your administrator security verification PIN to inspect or update the Master Google Apps Script Gateway URL and deployment scripts.
                  </p>
                  <div className="flex items-center gap-2">
                    <label htmlFor="admin-security-pin" className="sr-only">
                      Administrator Security PIN
                    </label>
                    <input
                      id="admin-security-pin"
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      value={pinInput}
                      onChange={(e) => setPinInput(e.target.value)}
                      placeholder="Enter security PIN"
                      className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm text-slate-900 focus:border-[#075E54] focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
                    >
                      Unlock
                    </button>
                  </div>
                  {pinError && <p className="text-xs text-red-600">{pinError}</p>}
                </form>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label
                      htmlFor="login-gateway-url"
                      className="block text-xs font-medium text-slate-700"
                    >
                      Master Apps Script Gateway URL (/exec)
                    </label>
                    <input
                      id="login-gateway-url"
                      type="url"
                      value={gatewayUrlDraft}
                      onChange={(e) => setGatewayUrlDraft(e.target.value)}
                      placeholder="https://script.google.com/macros/s/.../exec"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-900 focus:border-[#075E54] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="login-gateway-key"
                      className="block text-xs font-medium text-slate-700"
                    >
                      Optional Workspace Secret Key
                    </label>
                    <input
                      id="login-gateway-key"
                      type="password"
                      value={apiKeyDraft}
                      onChange={(e) => setApiKeyDraft(e.target.value)}
                      placeholder="Leave blank if open to OTP auth"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-900 focus:border-[#075E54] focus:outline-none"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() => void handleSaveAndPing()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#075E54] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#064c44]"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${busyAction === 'ping' ? 'animate-spin' : ''}`}
                      />
                      <span>Save &amp; Connect URL</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownloadScript('gateway')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Gateway_Code.gs</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownloadScript('worker')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Worker_Code.gs</span>
                    </button>
                  </div>

                  {serverMsg && (
                    <p
                      className={`rounded-lg border px-3 py-2 text-xs ${
                        serverMsg.type === 'ok'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                          : 'border-red-200 bg-red-50 text-red-800'
                      }`}
                    >
                      {serverMsg.text}
                    </p>
                  )}

                  <p className="border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">
                    After connecting your Gateway URL, complete WhatsApp OTP verification above to access the admin workspace.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <p className="text-center text-[11px] text-slate-500">
          &copy; 2026 QuantumDynamics Data Solution. All Rights Reserved.
        </p>
      </div>
    </div>
  );
}
