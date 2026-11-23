export type NavSection =
  | 'dashboard'
  | 'inbox'
  | 'broadcast'
  | 'contacts'
  | 'templates'
  | 'reports'
  | 'workspace'
  | 'admin_dev';

export type UserRole = 'ADMIN' | 'MANAGER' | 'AGENT';

export interface AuthSession {
  username: string;
  name: string;
  role: UserRole;
  phone: string;
  sessionToken: string;
  authenticatedAt: string;
  mode: 'whatsapp-otp' | 'admin-setup';
}

export interface AuthorizedOperator {
  id: string;
  name: string;
  role: UserRole;
  phone: string;
  maskedPhone: string;
}

export interface UpiConfig {
  vpa: string;
  payeeName: string;
  defaultNote: string;
}

export interface MetaLiveStats {
  fetchedAt: string;
  wabaId: string;
  phoneDisplay: string;
  qualityRating: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';
  messagingTier: string;
  nameStatus: string;
  totalConversations: number;
  totalCostInr: number;
  dailyTrend?: Array<{
    date: string;
    conversations: number;
    cost: number;
  }>;
  breakdown?: {
    marketing: { count: number; cost: number };
    utility: { count: number; cost: number };
    authentication: { count: number; cost: number };
    service: { count: number; cost: number };
  };
}

export interface ShardRecord {
  shardId: string;
  spreadsheetId: string;
  spreadsheetUrl: string;
  rowCount: number;
  archivedAt: string;
  dateRange: string;
}

export type ConversationStatus = 'open' | 'pending' | 'resolved';

export type MessageDirection = 'inbound' | 'outbound';

export type MessageDeliveryStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';

export type AttachmentKind = 'image' | 'document' | 'video' | 'audio';

export type MessageBillingCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION' | 'SERVICE';

export type AnalyticsTimeframe = 'daily' | 'weekly' | 'monthly';

export interface Attachment {
  id: string;
  kind: AttachmentKind;
  name: string;
  mimeType: string;
  url: string;
  sizeBytes?: number;
  driveFileId?: string;
  metaMediaId?: string;
  caption?: string;
}

export interface Contact {
  id: string;
  name: string;
  phone: string; // Normalized digits E.164 without '+'
  email: string;
  company: string;
  tags: string[];
  status: ConversationStatus;
  assignedAgent: string;
  custom1: string; // e.g., Order ID / Plan
  custom2: string; // e.g., City / Amount
  attachmentUrl: string; // Optional per-contact custom attachment URL for bulk campaigns
  attachmentName: string;
  notes: string;
  avatarUrl?: string;
  unreadCount: number;
  lastMessagePreview: string;
  lastMessageAt: string; // ISO string
}

export interface ChatMessage {
  id: string;
  contactId: string;
  phone: string;
  contactName: string;
  direction: MessageDirection;
  type: 'text' | 'template' | AttachmentKind;
  body: string;
  attachment?: Attachment;
  templateName?: string;
  campaignId?: string;
  status: MessageDeliveryStatus;
  waMessageId?: string;
  timestamp: string; // ISO string
  error?: string;
  // Analytics, Cost & Multi-Sheet External Source Metadata
  sourceSheet?: string; // e.g. 'SNC Web App', 'SNC Currenlty Working Google Sheet 22-11-2026'
  category?: MessageBillingCategory;
  deliveredAt?: string;
  readAt?: string;
  repliedAt?: string;
  billable?: boolean;
  estimatedCost?: number;
  receiptNo?: string;
}

export interface TemplateButton {
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
  text: string;
  url?: string;
  phoneNumber?: string;
}

export interface MessageTemplate {
  id: string;
  name: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  language: string;
  headerType: 'NONE' | 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'VIDEO';
  headerText?: string;
  headerExample?: string;
  body: string;
  footer?: string;
  variables: string[];
  exampleValues?: string[];
  buttons?: TemplateButton[];
  status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DRAFT';
  metaTemplateId?: string;
  source?: 'meta' | 'local';
  rejectedReason?: string;
  updatedAt: string;
}

export interface Campaign {
  id: string;
  name: string;
  createdAt: string;
  totalRecipients: number;
  sent: number;
  delivered: number;
  failed: number;
  templateName: string;
  messagePreview: string;
  attachmentMode: 'none' | 'shared' | 'per-contact';
  attachmentName?: string;
  attachmentUrl?: string;
  status: 'completed' | 'sending' | 'partial' | 'failed' | 'queued';
}

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  webViewLink: string;
  downloadUrl: string;
  createdTime: string;
  kind: AttachmentKind;
  source: 'google-drive' | 'local-library';
  metaMediaId?: string;
}

export interface ExternalSheetSource {
  id: string;
  label: string;
  spreadsheetId: string;
  spreadsheetUrl: string;
  tabName: string;
  defaultTemplate: string;
  defaultCategory: MessageBillingCategory;
  colPhone: string;
  colName: string;
  colMessage: string;
  colWaId: string;
  colStatus: string;
  colTimestamp: string;
  colAttachmentUrl: string;
  colReceiptNo: string;
  lastSyncedRow: number;
  lastSyncedAt: string | null;
  totalSynced: number;
  enabled: boolean;
}

export interface PricingRatesConfig {
  currency: 'INR' | 'USD';
  marketing: number;
  utility: number;
  authentication: number;
  service: number;
}

export interface WorkspaceConfig {
  businessName: string;
  phoneId: string;
  displayPhoneNumber: string;
  defaultCountryCode: string;
  driveFolderId: string;
  driveFolderUrl: string;
  attachmentsFolderId: string;
  spreadsheetId: string;
  spreadsheetUrl: string;
  appsScriptWebAppUrl: string;
  appsScriptApiKey: string;
  wabaId: string;
  webhookVerifyToken: string;
  rateLimitMs: number;
  dailyQuotaCap: number;
  autoLogToSheets: boolean;
  pricing: PricingRatesConfig;
  upi: UpiConfig;
  lastSyncedAt: string | null;
}

export interface WhatsAppApiStatus {
  configured: boolean;
  mode: 'live' | 'sandbox' | 'apps-script';
  phoneIdMasked: string | null;
  displayPhoneNumber?: string;
  businessName?: string;
  qualityRating?: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';
  messagingTier?: string;
  wabaIdConfigured?: boolean;
  apiVersion: string;
  webhookUrl: string;
  isPreviewUrl: boolean;
  verifyTokenConfigured: boolean;
  verifyTokenSource: 'env' | 'workspace';
  appSecretConfigured: boolean;
  receivedWebhookEvents: number;
  masterSheetName?: string;
  gatewayOnline?: boolean;
}

export interface ConfirmationRequest {
  title: string;
  description: string;
  details?: string[];
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  onConfirm: () => Promise<void> | void;
}
