import type {
  AuthorizedOperator,
  Campaign,
  ChatMessage,
  Contact,
  DriveFileItem,
  ExternalSheetSource,
  MessageTemplate,
  WorkspaceConfig,
} from '../types';
import { DEFAULT_PRICING_RATES } from '../utils/analyticsLogic';

export const AUTHORIZED_OPERATORS: AuthorizedOperator[] = [
  {
    id: 'op-parag',
    name: 'Parag Sureshrao Chaware',
    role: 'ADMIN',
    phone: '919975649575',
    maskedPhone: '+91 ••••••9575',
  },
  {
    id: 'op-sanket',
    name: 'Sanket Rathod',
    role: 'ADMIN',
    phone: '917020178679',
    maskedPhone: '+91 ••••••8679',
  },
  {
    id: 'op-admin-3',
    name: 'Authorized Admin',
    role: 'ADMIN',
    phone: '919922775569',
    maskedPhone: '+91 ••••••5569',
  },
];

export const OPERATOR_PROFILE = {
  name: 'Parag Sureshrao Chaware',
  role: 'Workspace Admin',
  avatarUrl: './src/assets/images/avatar_operator_snc_1795343159395.jpg',
};

// Zero dummy data: All contacts, messages, approved templates, campaigns, and Drive files
// load live directly from your Meta WhatsApp Business API & Google Sheets Master Gateway.
export const INITIAL_CONTACTS: Contact[] = [];
export const INITIAL_MESSAGES: ChatMessage[] = [];
export const INITIAL_TEMPLATES: MessageTemplate[] = [];
export const INITIAL_CAMPAIGNS: Campaign[] = [];
export const INITIAL_DRIVE_FILES: DriveFileItem[] = [];

// Zero hardcoded spreadsheet IDs: external sheets load dynamically from your Connected_Sheets tab
export const INITIAL_EXTERNAL_SHEETS: ExternalSheetSource[] = [];

// Fetched dynamically from the connected Apps Script Gateway URL (no hardcoded folder or sheet IDs)
export const MAIN_DRIVE_FOLDER_ID = '';

function readBuildGatewayUrl(): string {
  try {
    const raw = String(
      (import.meta as unknown as { env?: Record<string, string | undefined> })?.env
        ?.VITE_APPS_SCRIPT_GATEWAY_URL || ''
    ).trim();
    if (!raw) return '';
    const parsed = new URL(raw);
    if (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'script.google.com' ||
        parsed.hostname === 'script.googleusercontent.com')
    ) {
      return raw;
    }
  } catch {
    // Ignore invalid URL
  }
  return '';
}

export const ENV_GATEWAY_URL = readBuildGatewayUrl();

export const INITIAL_WORKSPACE_CONFIG: WorkspaceConfig = {
  businessName: 'SNC WhatsApp Business',
  phoneId: '',
  displayPhoneNumber: '',
  defaultCountryCode: '91',
  driveFolderId: '',
  driveFolderUrl: '',
  attachmentsFolderId: '',
  spreadsheetId: '',
  spreadsheetUrl: '',
  appsScriptWebAppUrl: ENV_GATEWAY_URL,
  appsScriptApiKey: '',
  wabaId: '',
  webhookVerifyToken: '',
  rateLimitMs: 1200,
  dailyQuotaCap: 850,
  autoLogToSheets: true,
  pricing: DEFAULT_PRICING_RATES,
  upi: {
    vpa: '',
    payeeName: '',
    defaultNote: '',
  },
  lastSyncedAt: null,
};
