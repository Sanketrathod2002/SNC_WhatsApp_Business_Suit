import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCheck,
  Clock,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Info,
  Lock,
  Music,
  Paperclip,
  Plus,
  Search,
  Send,
  Sparkles,
  Upload,
  Video,
  X,
} from 'lucide-react';
import type {
  Attachment,
  ChatMessage,
  Contact,
  ConversationStatus,
  DriveFileItem,
  MessageTemplate,
} from '../types';
import {
  compute24HourWindow,
  formatFileSize,
  formatPhoneDisplay,
  getDriveBrowserViewUrl,
  getDriveViewableThumbnailUrl,
  inferAttachmentKind,
  isSafeHttpsUrl,
  isValidPhone,
  normalizeDriveDownloadUrl,
  normalizePhone,
  parseApprovedTemplateSchema,
  renderApprovedTemplatePreview,
  tokenizeWhatsAppMarkdown,
  type TemplateFieldFormat,
} from '../utils/whatsappLogic';

interface TeamInboxViewProps {
  contacts: Contact[];
  messages: ChatMessage[];
  templates: MessageTemplate[];
  driveFiles: DriveFileItem[];
  selectedContactId: string | null;
  defaultCountryCode: string;
  gatewayConfigured: boolean;
  onSelectContact: (contactId: string) => void;
  onSendMessage: (params: {
    contact: Contact;
    body: string;
    attachment?: Attachment;
    templateName?: string;
    templateLanguage?: string;
    templateParams?: string[];
    templateHeaderType?: 'NONE' | 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'VIDEO';
    templateHeaderParams?: string[];
    templateButtonParams?: string[];
    localFile?: File;
  }) => Promise<void>;
  onStartNewChat: (params: {
    name: string;
    phone: string;
    company: string;
    initialMessage: string;
  }) => Promise<void>;
  onUpdateContact: (contact: Contact) => void;
  onUploadFileToDrive: (file: File) => Promise<DriveFileItem | null>;
}

function FormattedWhatsAppBody({ text }: { text: string }) {
  const tokens = tokenizeWhatsAppMarkdown(text);
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-900">
      {tokens.map((tok, i) => {
        if (tok.type === 'bold') {
          return (
            <strong key={i} className="font-semibold">
              {tok.value}
            </strong>
          );
        }
        if (tok.type === 'italic') {
          return (
            <em key={i} className="italic">
              {tok.value}
            </em>
          );
        }
        if (tok.type === 'strike') {
          return (
            <s key={i} className="line-through text-slate-500">
              {tok.value}
            </s>
          );
        }
        if (tok.type === 'code') {
          return (
            <code
              key={i}
              className="rounded bg-black/5 px-1 py-0.5 font-mono text-xs text-slate-800"
            >
              {tok.value}
            </code>
          );
        }
        if (tok.type === 'link') {
          return (
            <a
              key={i}
              href={tok.value}
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-[#075E54] hover:text-[#05453d] break-all"
            >
              {tok.value}
            </a>
          );
        }
        return <span key={i}>{tok.value}</span>;
      })}
    </p>
  );
}

function getInitials(name: string): string {
  const parts = (name || '').trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function formatShortTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatInputTypeForField(format: TemplateFieldFormat): 'text' | 'date' | 'url' {
  if (format === 'date') return 'date';
  if (format === 'url') return 'url';
  return 'text';
}

function formatDateDisplay(isoDate: string): string {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return isoDate;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export function TeamInboxView({
  contacts,
  messages,
  templates,
  driveFiles,
  selectedContactId,
  defaultCountryCode,
  gatewayConfigured,
  onSelectContact,
  onSendMessage,
  onStartNewChat,
  onUpdateContact,
  onUploadFileToDrive,
}: TeamInboxViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unread' | ConversationStatus>('all');
  const [sourceSheetFilter, setSourceSheetFilter] = useState<string>('ALL');
  const [draftText, setDraftText] = useState('');

  // Structured Pre-Approved Meta Template state
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [templateBodyValues, setTemplateBodyValues] = useState<string[]>([]);
  const [templateHeaderValues, setTemplateHeaderValues] = useState<string[]>([]);
  const [templateButtonValue, setTemplateButtonValue] = useState('');
  const [templateFormError, setTemplateFormError] = useState('');

  const [pendingAttachment, setPendingAttachment] = useState<Attachment | null>(null);
  const [pendingLocalFile, setPendingLocalFile] = useState<File | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [showInfoPanel, setShowInfoPanel] = useState(true);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showAttachModal, setShowAttachModal] = useState(false);
  const [attachUrlInput, setAttachUrlInput] = useState('');
  const [attachNameInput, setAttachNameInput] = useState('');
  const [attachError, setAttachError] = useState('');
  const [isUploadingDrive, setIsUploadingDrive] = useState(false);

  // New Chat modal state
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatName, setNewChatName] = useState('');
  const [newChatPhone, setNewChatPhone] = useState('');
  const [newChatCompany, setNewChatCompany] = useState('');
  const [newChatMessage, setNewChatMessage] = useState('');
  const [newChatError, setNewChatError] = useState('');

  // Right-pane CRM notes & tag inputs
  const [notesDraft, setNotesDraft] = useState('');
  const [custom1Draft, setCustom1Draft] = useState('');
  const [custom2Draft, setCustom2Draft] = useState('');
  const [newTagInput, setNewTagInput] = useState('');
  const [crmSavedNotice, setCrmSavedNotice] = useState(false);

  // Mobile toggle between conversation list and active thread
  const [mobileShowThread, setMobileShowThread] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const approvedTemplates = useMemo(
    () => templates.filter((t) => t.status === 'APPROVED'),
    [templates]
  );

  const selectedTemplateObj = useMemo(
    () => approvedTemplates.find((t) => t.id === selectedTemplateId) || null,
    [approvedTemplates, selectedTemplateId]
  );

  const selectedTemplateSchema = useMemo(
    () => (selectedTemplateObj ? parseApprovedTemplateSchema(selectedTemplateObj) : null),
    [selectedTemplateObj]
  );

  const formattedBodyParams = useMemo(() => {
    if (!selectedTemplateSchema) return [];
    return selectedTemplateSchema.bodyFields.map((field, idx) => {
      const raw = (templateBodyValues[idx] || '').trim();
      return field.format === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(raw)
        ? formatDateDisplay(raw)
        : raw;
    });
  }, [selectedTemplateSchema, templateBodyValues]);

  const formattedHeaderParams = useMemo(() => {
    if (!selectedTemplateSchema) return [];
    return selectedTemplateSchema.headerTextFields.map((field, idx) => {
      const raw = (templateHeaderValues[idx] || '').trim();
      return field.format === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(raw)
        ? formatDateDisplay(raw)
        : raw;
    });
  }, [selectedTemplateSchema, templateHeaderValues]);

  const selectedTemplatePreview = useMemo(() => {
    if (!selectedTemplateObj) return null;
    return renderApprovedTemplatePreview(
      selectedTemplateObj,
      formattedBodyParams,
      formattedHeaderParams
    );
  }, [selectedTemplateObj, formattedBodyParams, formattedHeaderParams]);

  const availableSources = useMemo(() => {
    const set = new Set<string>();
    messages.forEach((m) => {
      if (m.sourceSheet) set.add(m.sourceSheet);
    });
    return Array.from(set);
  }, [messages]);

  const filteredContacts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...contacts]
      .filter((c) => {
        if (statusFilter === 'unread' && c.unreadCount <= 0) return false;
        if (
          statusFilter !== 'all' &&
          statusFilter !== 'unread' &&
          c.status !== statusFilter
        ) {
          return false;
        }
        if (sourceSheetFilter !== 'ALL') {
          const hasFromSource = messages.some(
            (m) =>
              (m.contactId === c.id || m.phone === c.phone) &&
              m.sourceSheet === sourceSheetFilter
          );
          if (!hasFromSource) return false;
        }
        if (!q) return true;
        return (
          c.name.toLowerCase().includes(q) ||
          c.phone.includes(q.replace(/\D/g, '') || q) ||
          c.company.toLowerCase().includes(q) ||
          c.tags.some((t) => t.toLowerCase().includes(q))
        );
      })
      .sort(
        (a, b) =>
          new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
      );
  }, [contacts, messages, searchQuery, statusFilter, sourceSheetFilter]);

  const activeContact = useMemo(
    () => contacts.find((c) => c.id === selectedContactId) || filteredContacts[0] || null,
    [contacts, selectedContactId, filteredContacts]
  );

  const activeMessages = useMemo(() => {
    if (!activeContact) return [];
    return messages
      .filter((m) => m.contactId === activeContact.id || m.phone === activeContact.phone)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [messages, activeContact]);

  const policyWindow = useMemo(
    () => compute24HourWindow(activeMessages),
    [activeMessages]
  );

  const isFreeFormLocked = !policyWindow.active && !selectedTemplateObj;

  useEffect(() => {
    if (activeContact) {
      setNotesDraft(activeContact.notes);
      setCustom1Draft(activeContact.custom1);
      setCustom2Draft(activeContact.custom2);
      setCrmSavedNotice(false);
      setSelectedTemplateId(null);
      setTemplateBodyValues([]);
      setTemplateHeaderValues([]);
      setTemplateButtonValue('');
      setTemplateFormError('');
    }
  }, [activeContact?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages.length, activeContact?.id]);

  const handleSelectApprovedTemplate = (tpl: MessageTemplate) => {
    const schema = parseApprovedTemplateSchema(tpl);
    const todayIso = new Date().toISOString().slice(0, 10);

    const initialBodyVals = schema.bodyFields.map((field, idx) => {
      if (field.format === 'date') return todayIso;
      if (idx === 0 && field.format === 'text' && activeContact?.name) {
        return activeContact.name;
      }
      return '';
    });

    const initialHeaderVals = schema.headerTextFields.map((field) =>
      field.format === 'date' ? todayIso : ''
    );

    setSelectedTemplateId(tpl.id);
    setTemplateBodyValues(initialBodyVals);
    setTemplateHeaderValues(initialHeaderVals);
    setTemplateButtonValue('');
    setTemplateFormError('');
    setShowTemplatePicker(false);
  };

  const handleClearTemplate = () => {
    setSelectedTemplateId(null);
    setTemplateBodyValues([]);
    setTemplateHeaderValues([]);
    setTemplateButtonValue('');
    setTemplateFormError('');
  };

  const handleSend = async () => {
    if (!activeContact) return;

    // Strict Pre-Approved Meta Template dispatch path
    if (selectedTemplateObj && selectedTemplateSchema) {
      setTemplateFormError('');

      if (selectedTemplateSchema.headerMediaType !== 'NONE') {
        if (!pendingAttachment) {
          setTemplateFormError(
            `This approved template requires a ${selectedTemplateSchema.headerMediaType} header file. Click "Attach ${selectedTemplateSchema.headerMediaType}" first.`
          );
          return;
        }
        const expectedKind =
          selectedTemplateSchema.headerMediaType === 'IMAGE'
            ? 'image'
            : selectedTemplateSchema.headerMediaType === 'VIDEO'
              ? 'video'
              : 'document';
        if (pendingAttachment.kind !== expectedKind && expectedKind !== 'document') {
          setTemplateFormError(
            `Approved template header expects a ${selectedTemplateSchema.headerMediaType} file, but you attached a ${pendingAttachment.kind.toUpperCase()}.`
          );
          return;
        }
      }

      for (let i = 0; i < selectedTemplateSchema.headerTextFields.length; i++) {
        const val = formattedHeaderParams[i];
        const spec = selectedTemplateSchema.headerTextFields[i];
        if (!val) {
          setTemplateFormError(`Please enter ${spec.label}.`);
          return;
        }
        if (spec.format === 'url' && !isSafeHttpsUrl(val)) {
          setTemplateFormError(`${spec.label} must be a valid https:// link.`);
          return;
        }
      }

      for (let i = 0; i < selectedTemplateSchema.bodyFields.length; i++) {
        const val = formattedBodyParams[i];
        const spec = selectedTemplateSchema.bodyFields[i];
        if (!val) {
          setTemplateFormError(`Please enter ${spec.label} before sending.`);
          return;
        }
        if (spec.format === 'url' && !isSafeHttpsUrl(val)) {
          setTemplateFormError(`${spec.label} must be a valid https:// link.`);
          return;
        }
      }

      if (selectedTemplateSchema.buttonUrlField && !templateButtonValue.trim()) {
        setTemplateFormError(
          `Please enter ${selectedTemplateSchema.buttonUrlField.label}.`
        );
        return;
      }

      const previewText = selectedTemplatePreview?.bodyPreview || selectedTemplateObj.body;

      setIsSending(true);
      try {
        await onSendMessage({
          contact: activeContact,
          body: previewText,
          attachment: pendingAttachment || undefined,
          templateName: selectedTemplateObj.name,
          templateLanguage: selectedTemplateObj.language,
          templateParams: formattedBodyParams,
          templateHeaderType: selectedTemplateObj.headerType,
          templateHeaderParams: formattedHeaderParams,
          templateButtonParams:
            selectedTemplateSchema.buttonUrlField && templateButtonValue.trim()
              ? [templateButtonValue.trim()]
              : undefined,
          localFile: pendingLocalFile || undefined,
        });
        handleClearTemplate();
        setPendingAttachment(null);
        setPendingLocalFile(null);
        setShowTemplatePicker(false);
      } finally {
        setIsSending(false);
      }
      return;
    }

    // Standard 24-hour free-form reply path
    if (isFreeFormLocked) {
      setShowTemplatePicker(true);
      return;
    }
    const trimmed = draftText.trim();
    if (!trimmed && !pendingAttachment) return;

    setIsSending(true);
    try {
      await onSendMessage({
        contact: activeContact,
        body: trimmed,
        attachment: pendingAttachment || undefined,
        localFile: pendingLocalFile || undefined,
      });
      setDraftText('');
      setPendingAttachment(null);
      setPendingLocalFile(null);
      setShowTemplatePicker(false);
    } finally {
      setIsSending(false);
    }
  };

  const handleLocalFileChange = async (file: File | undefined) => {
    if (!file) return;
    setAttachError('');
    const kind = inferAttachmentKind(file.type, file.name);
    const localUrl = URL.createObjectURL(file);

    if (gatewayConfigured) {
      setIsUploadingDrive(true);
      try {
        const uploaded = await onUploadFileToDrive(file);
        if (uploaded) {
          setPendingAttachment({
            id: uploaded.id,
            kind: uploaded.kind,
            name: uploaded.name,
            mimeType: uploaded.mimeType,
            url: uploaded.downloadUrl,
            sizeBytes: uploaded.sizeBytes,
            driveFileId: uploaded.id,
          });
          setPendingLocalFile(file);
          setTemplateFormError('');
          setShowAttachModal(false);
          return;
        }
      } finally {
        setIsUploadingDrive(false);
      }
    }

    setPendingAttachment({
      id: `local-${Date.now()}`,
      kind,
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      url: localUrl,
      sizeBytes: file.size,
    });
    setPendingLocalFile(file);
    setTemplateFormError('');
    setShowAttachModal(false);
  };

  const handleAttachHttpsUrl = () => {
    setAttachError('');
    if (!isSafeHttpsUrl(attachUrlInput)) {
      setAttachError('Enter a valid public https:// attachment URL.');
      return;
    }
    const cleanName =
      attachNameInput.trim() ||
      attachUrlInput.split('/').pop()?.split('?')[0] ||
      'attachment.pdf';
    const kind = inferAttachmentKind('', cleanName);
    const normalizedUrl = normalizeDriveDownloadUrl(attachUrlInput.trim());
    setPendingAttachment({
      id: `url-${Date.now()}`,
      kind,
      name: cleanName,
      mimeType:
        kind === 'image'
          ? 'image/jpeg'
          : kind === 'video'
            ? 'video/mp4'
            : kind === 'audio'
              ? 'audio/mpeg'
              : 'application/pdf',
      url: normalizedUrl || attachUrlInput.trim(),
    });
    setPendingLocalFile(null);
    setAttachUrlInput('');
    setAttachNameInput('');
    setTemplateFormError('');
    setShowAttachModal(false);
  };

  const handleSelectDriveFile = (file: DriveFileItem) => {
    setPendingAttachment({
      id: file.id,
      kind: file.kind,
      name: file.name,
      mimeType: file.mimeType,
      url: file.downloadUrl,
      sizeBytes: file.sizeBytes,
      driveFileId: file.source === 'google-drive' ? file.id : undefined,
    });
    setPendingLocalFile(null);
    setTemplateFormError('');
    setShowAttachModal(false);
  };

  const handleCreateNewChat = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewChatError('');
    const normalized = normalizePhone(newChatPhone, defaultCountryCode);
    if (!isValidPhone(normalized)) {
      setNewChatError('Enter a valid WhatsApp phone number (7 to 15 digits with country code).');
      return;
    }
    if (!newChatMessage.trim()) {
      setNewChatError('Enter an opening message to send.');
      return;
    }

    await onStartNewChat({
      name: newChatName.trim() || `Contact ${normalized.slice(-4)}`,
      phone: normalized,
      company: newChatCompany.trim(),
      initialMessage: newChatMessage.trim(),
    });

    setNewChatName('');
    setNewChatPhone('');
    setNewChatCompany('');
    setNewChatMessage('');
    setShowNewChatModal(false);
    setMobileShowThread(true);
  };

  const handleSaveCrmDetails = () => {
    if (!activeContact) return;
    onUpdateContact({
      ...activeContact,
      notes: notesDraft,
      custom1: custom1Draft.trim(),
      custom2: custom2Draft.trim(),
    });
    setCrmSavedNotice(true);
    setTimeout(() => setCrmSavedNotice(false), 2500);
  };

  const handleAddTag = () => {
    if (!activeContact) return;
    const clean = newTagInput.trim();
    if (!clean || activeContact.tags.includes(clean)) return;
    onUpdateContact({
      ...activeContact,
      tags: [...activeContact.tags, clean],
    });
    setNewTagInput('');
  };

  const handleRemoveTag = (tag: string) => {
    if (!activeContact) return;
    onUpdateContact({
      ...activeContact,
      tags: activeContact.tags.filter((t) => t !== tag),
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden bg-white">
      {/* Pane 1: Conversation List */}
      <section
        aria-label="Conversations"
        className={`flex w-full shrink-0 flex-col border-r border-slate-200 bg-white md:w-[320px] xl:w-[348px] ${
          mobileShowThread ? 'hidden md:flex' : 'flex'
        }`}
      >
        <div className="border-b border-slate-200 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">Chats</h2>
            <button
              type="button"
              onClick={() => setShowNewChatModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#075E54] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#064c44] whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New Chat</span>
            </button>
          </div>

          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search name, phone, or tag..."
              aria-label="Search conversations"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#075E54] focus:bg-white focus:outline-none"
            />
          </div>

          <div
            role="tablist"
            aria-label="Filter conversations"
            className="mt-3 grid grid-cols-4 gap-1 rounded-lg bg-slate-100 p-1"
          >
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'unread', label: 'Unread' },
                { id: 'open', label: 'Open' },
                { id: 'resolved', label: 'Resolved' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={statusFilter === tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`rounded-md py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                  statusFilter === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {availableSources.length > 0 && (
            <div className="mt-2.5">
              <label htmlFor="inbox-source-filter" className="sr-only">
                Filter by source sheet
              </label>
              <select
                id="inbox-source-filter"
                value={sourceSheetFilter}
                onChange={(e) => setSourceSheetFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-[#075E54] focus:outline-none"
              >
                <option value="ALL">All Source Channels</option>
                {availableSources.map((src) => (
                  <option key={src} value={src}>
                    Source: {src}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {filteredContacts.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
              <p className="text-sm font-medium text-slate-700">No conversations match</p>
              <p className="mt-1 text-xs text-slate-500">
                Try clearing filters or start a new WhatsApp chat.
              </p>
            </div>
          ) : (
            filteredContacts.map((contact) => {
              const selected = activeContact?.id === contact.id;
              return (
                <button
                  key={contact.id}
                  type="button"
                  onClick={() => {
                    onSelectContact(contact.id);
                    setMobileShowThread(true);
                  }}
                  className={`flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors ${
                    selected ? 'bg-emerald-50/70' : 'hover:bg-slate-50'
                  }`}
                >
                  {contact.avatarUrl ? (
                    <img
                      src={contact.avatarUrl}
                      alt={contact.name}
                      referrerPolicy="no-referrer"
                      className="h-11 w-11 shrink-0 rounded-full object-cover border border-slate-200"
                    />
                  ) : (
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700 border border-slate-200">
                      {getInitials(contact.name)}
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-slate-900">
                        {contact.name}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-slate-400 tabular-nums">
                        {formatShortTime(contact.lastMessageAt)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-600">
                      {contact.lastMessagePreview || formatPhoneDisplay(contact.phone)}
                    </p>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-400">
                      <span className="truncate">
                        {contact.company || formatPhoneDisplay(contact.phone)}
                        {contact.tags.length > 0 ? ` · ${contact.tags[0]}` : ''}
                      </span>
                      {contact.unreadCount > 0 && (
                        <span className="shrink-0 font-mono text-xs font-bold text-[#075E54] tabular-nums">
                          {contact.unreadCount} new
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </section>

      {/* Pane 2: Active WhatsApp Chat Canvas */}
      <section
        aria-label="Active chat thread"
        className={`flex min-w-0 flex-1 flex-col ${
          mobileShowThread ? 'flex' : 'hidden md:flex'
        }`}
      >
        {activeContact ? (
          <>
            {/* Chat Header */}
            <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 lg:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => setMobileShowThread(false)}
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 md:hidden"
                >
                  Back
                </button>
                {activeContact.avatarUrl ? (
                  <img
                    src={activeContact.avatarUrl}
                    alt={activeContact.name}
                    referrerPolicy="no-referrer"
                    className="h-10 w-10 shrink-0 rounded-full object-cover border border-slate-200"
                  />
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-xs font-semibold text-[#075E54]">
                    {getInitials(activeContact.name)}
                  </div>
                )}
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold text-slate-900">
                    {activeContact.name}
                  </h2>
                  <p className="truncate font-mono text-xs text-slate-500 tabular-nums">
                    {formatPhoneDisplay(activeContact.phone)}
                    {activeContact.company ? ` · ${activeContact.company}` : ''}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <label htmlFor="chat-status-select" className="sr-only">
                  Conversation status
                </label>
                <select
                  id="chat-status-select"
                  value={activeContact.status}
                  onChange={(e) =>
                    onUpdateContact({
                      ...activeContact,
                      status: e.target.value as ConversationStatus,
                    })
                  }
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-[#075E54] focus:outline-none"
                >
                  <option value="open">Open</option>
                  <option value="pending">Pending</option>
                  <option value="resolved">Resolved</option>
                </select>
                <button
                  type="button"
                  onClick={() => setShowInfoPanel((prev) => !prev)}
                  aria-label="Toggle contact details panel"
                  aria-expanded={showInfoPanel}
                  className={`rounded-lg border p-2 transition-colors ${
                    showInfoPanel
                      ? 'border-emerald-200 bg-emerald-50 text-[#075E54]'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Info className="h-4 w-4" />
                </button>
              </div>
            </header>

            {/* Meta 24-Hour Customer Service Window Policy Banner */}
            <div
              className={`flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-xs lg:px-6 ${
                policyWindow.active
                  ? 'border-emerald-200/70 bg-emerald-50/70 text-emerald-950'
                  : 'border-amber-200 bg-amber-50 text-amber-950'
              }`}
            >
              <div className="flex items-center gap-2">
                {policyWindow.active ? (
                  <Clock className="h-3.5 w-3.5 shrink-0 text-[#075E54]" />
                ) : (
                  <Lock className="h-3.5 w-3.5 shrink-0 text-amber-700" />
                )}
                {policyWindow.active ? (
                  <span className="tabular-nums">
                    <strong>24h Free Service Window Open:</strong> {policyWindow.hours}h{' '}
                    {policyWindow.minutes}m remaining for free-form replies
                  </span>
                ) : (
                  <span>
                    <strong>24h Policy Window Expired:</strong> Meta requires an approved template to re-open this conversation.
                  </span>
                )}
              </div>
              {!policyWindow.active && (
                <button
                  type="button"
                  onClick={() => setShowTemplatePicker(true)}
                  className="rounded-md bg-amber-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-800 whitespace-nowrap"
                >
                  Select Approved Template
                </button>
              )}
            </div>

            {/* Chat Messages Scroll Area */}
            <div className="chat-wallpaper flex-1 overflow-y-auto px-4 py-5 lg:px-8">
              <div className="mx-auto flex max-w-3xl flex-col gap-3">
                {activeMessages.length === 0 ? (
                  <div className="mx-auto my-12 rounded-xl border border-slate-200 bg-white/95 px-6 py-5 text-center shadow-xs">
                    <p className="text-sm font-medium text-slate-800">
                      Start chatting with {activeContact.name}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Messages sent here dispatch directly via WhatsApp Business API.
                    </p>
                  </div>
                ) : (
                  activeMessages.map((msg) => {
                    const isOut = msg.direction === 'outbound';
                    const viewUrl = msg.attachment?.url
                      ? getDriveBrowserViewUrl(msg.attachment.url)
                      : '';
                    const thumbUrl = msg.attachment?.url
                      ? getDriveViewableThumbnailUrl(msg.attachment.url)
                      : '';

                    return (
                      <div
                        key={msg.id}
                        className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[82%] rounded-xl px-3.5 py-2.5 shadow-xs sm:max-w-[70%] ${
                            isOut
                              ? 'rounded-tr-xs bg-[#D9FDD3] text-slate-900'
                              : 'rounded-tl-xs border border-slate-200/80 bg-white text-slate-900'
                          }`}
                        >
                          {msg.templateName && (
                            <p className="mb-1 font-mono text-[11px] font-medium text-[#075E54]">
                              Template · {msg.templateName}
                            </p>
                          )}

                          {msg.attachment && (
                            <div className="mb-2 overflow-hidden rounded-lg border border-black/10 bg-white/90">
                              {msg.attachment.kind === 'image' && thumbUrl ? (
                                <div>
                                  <a
                                    href={viewUrl || thumbUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block"
                                  >
                                    <img
                                      src={thumbUrl}
                                      alt={msg.attachment.name}
                                      referrerPolicy="no-referrer"
                                      className="max-h-60 w-full object-cover bg-slate-100"
                                    />
                                  </a>
                                  <div className="flex items-center justify-between gap-2 border-t border-black/5 px-2.5 py-1.5 text-[11px]">
                                    <span className="truncate font-medium text-slate-700">
                                      {msg.attachment.name}
                                    </span>
                                    {isSafeHttpsUrl(viewUrl) && (
                                      <a
                                        href={viewUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex shrink-0 items-center gap-1 font-medium text-[#075E54] hover:underline"
                                      >
                                        <span>Open</span>
                                        <ExternalLink className="h-3 w-3" />
                                      </a>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center gap-3 p-3">
                                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-[#075E54]">
                                    {msg.attachment.kind === 'video' ? (
                                      <Video className="h-4 w-4" />
                                    ) : msg.attachment.kind === 'audio' ? (
                                      <Music className="h-4 w-4" />
                                    ) : (
                                      <FileText className="h-4 w-4" />
                                    )}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-xs font-semibold text-slate-900">
                                      {msg.attachment.name}
                                    </p>
                                    <p className="text-[11px] text-slate-500 tabular-nums">
                                      {msg.attachment.kind.toUpperCase()}
                                      {msg.attachment.sizeBytes
                                        ? ` · ${formatFileSize(msg.attachment.sizeBytes)}`
                                        : ''}
                                    </p>
                                  </div>
                                  {isSafeHttpsUrl(viewUrl) && (
                                    <a
                                      href={viewUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      aria-label={`View ${msg.attachment.name}`}
                                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-[#075E54] hover:bg-emerald-50 whitespace-nowrap"
                                    >
                                      <span>View</span>
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {msg.body && <FormattedWhatsAppBody text={msg.body} />}

                          {msg.error && (
                            <p className="mt-1 text-xs font-medium text-red-700">
                              Delivery error: {msg.error}
                            </p>
                          )}

                          <div className="mt-1 flex items-center justify-end gap-1.5 text-[11px] text-slate-500">
                            <span className="font-mono tabular-nums">
                              {formatShortTime(msg.timestamp)}
                            </span>
                            {isOut && (
                              <span
                                aria-label={`Status: ${msg.status}`}
                                className="inline-flex items-center"
                              >
                                {msg.status === 'read' && (
                                  <CheckCheck className="h-3.5 w-3.5 text-sky-600" />
                                )}
                                {msg.status === 'delivered' && (
                                  <CheckCheck className="h-3.5 w-3.5 text-slate-500" />
                                )}
                                {msg.status === 'sent' && (
                                  <Check className="h-3.5 w-3.5 text-slate-500" />
                                )}
                                {msg.status === 'queued' && (
                                  <Clock className="h-3 w-3 text-slate-400" />
                                )}
                                {msg.status === 'failed' && (
                                  <span className="font-semibold text-red-600">Failed</span>
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Composer Area */}
            <div className="relative shrink-0 border-t border-slate-200 bg-white p-3 lg:px-5">
              {/* Pre-Approved Meta Templates Popover */}
              {showTemplatePicker && (
                <div className="absolute bottom-full left-4 right-4 z-20 mb-2 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-800">
                      Select Pre-Approved Meta Template for {activeContact.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowTemplatePicker(false)}
                      aria-label="Close template picker"
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {approvedTemplates.length === 0 ? (
                      <p className="py-3 text-center text-xs text-slate-500">
                        No pre-approved Meta templates synced yet. Open Pre-Approved Templates on the left sidebar and sync live templates from Meta.
                      </p>
                    ) : (
                      approvedTemplates.map((tpl) => {
                        const sc = parseApprovedTemplateSchema(tpl);
                        return (
                          <button
                            key={tpl.id}
                            type="button"
                            onClick={() => handleSelectApprovedTemplate(tpl)}
                            className="w-full py-2.5 text-left transition-colors hover:bg-slate-50 px-2 rounded-md"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-mono text-xs font-semibold text-[#075E54]">
                                {tpl.name}
                              </span>
                              <span className="text-[11px] font-medium text-emerald-700">
                                APPROVED · {tpl.category} · {tpl.language}
                                {sc.headerMediaType !== 'NONE' ? ` · ${sc.headerMediaType} Header` : ''}
                                {sc.bodyFields.length > 0 ? ` · ${sc.bodyFields.length} Param(s)` : ' · No Params'}
                              </span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                              {tpl.body}
                            </p>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* Structured Pre-Approved Template Parameter Entry Panel */}
              {selectedTemplateObj && selectedTemplateSchema ? (
                <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono font-semibold text-[#075E54]">
                        {selectedTemplateObj.name}
                      </span>
                      <span className="rounded bg-white px-2 py-0.5 font-mono text-[11px] text-slate-600 border border-emerald-200">
                        {selectedTemplateObj.category} · {selectedTemplateObj.language}
                      </span>
                      <span className="text-[11px] text-emerald-800">
                        Locked Meta Approved Format
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleClearTemplate}
                      aria-label="Cancel approved template"
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <X className="h-3 w-3" />
                      <span>Cancel</span>
                    </button>
                  </div>

                  {/* Required Media Header Row (DOCUMENT / IMAGE / VIDEO) */}
                  {selectedTemplateSchema.headerMediaType !== 'NONE' && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                      <div className="min-w-0">
                        <span className="font-semibold text-slate-900">
                          Required {selectedTemplateSchema.headerMediaType} Header
                        </span>
                        <p className="truncate text-[11px] text-slate-500">
                          {pendingAttachment
                            ? `Attached: ${pendingAttachment.name} (${pendingAttachment.kind.toUpperCase()})`
                            : `Attach a ${selectedTemplateSchema.headerMediaType} file or Drive link matching this template header.`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setShowAttachModal(true)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-[#075E54] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#064c44]"
                        >
                          <Paperclip className="h-3.5 w-3.5" />
                          <span>
                            {pendingAttachment
                              ? 'Change File'
                              : `Attach ${selectedTemplateSchema.headerMediaType}`}
                          </span>
                        </button>
                        {pendingAttachment && (
                          <button
                            type="button"
                            onClick={() => {
                              setPendingAttachment(null);
                              setPendingLocalFile(null);
                            }}
                            aria-label="Remove header attachment"
                            className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Strict Format-Labeled Parameter Inputs */}
                  {(selectedTemplateSchema.headerTextFields.length > 0 ||
                    selectedTemplateSchema.bodyFields.length > 0 ||
                    selectedTemplateSchema.buttonUrlField) && (
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      {selectedTemplateSchema.headerTextFields.map((field, idx) => (
                        <div key={`hdr-${field.token}`}>
                          <div className="flex items-center justify-between gap-2">
                            <label
                              htmlFor={`tpl-hdr-${field.token}`}
                              className="text-[11px] font-semibold text-slate-800"
                            >
                              {field.label}
                            </label>
                            <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#075E54] border border-slate-200">
                              {field.formatLabel}
                            </span>
                          </div>
                          <input
                            id={`tpl-hdr-${field.token}`}
                            type={formatInputTypeForField(field.format)}
                            inputMode={field.format === 'number' ? 'decimal' : undefined}
                            value={templateHeaderValues[idx] || ''}
                            onChange={(e) => {
                              const next = [...templateHeaderValues];
                              next[idx] = e.target.value;
                              setTemplateHeaderValues(next);
                              setTemplateFormError('');
                            }}
                            placeholder={field.example || `Enter ${field.formatLabel.toLowerCase()}...`}
                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-[#075E54] focus:outline-none"
                          />
                        </div>
                      ))}

                      {selectedTemplateSchema.bodyFields.map((field, idx) => (
                        <div key={`body-${field.token}`}>
                          <div className="flex items-center justify-between gap-2">
                            <label
                              htmlFor={`tpl-body-${field.token}`}
                              className="text-[11px] font-semibold text-slate-800"
                            >
                              {field.label}
                            </label>
                            <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#075E54] border border-slate-200">
                              {field.formatLabel}
                            </span>
                          </div>
                          <input
                            id={`tpl-body-${field.token}`}
                            type={formatInputTypeForField(field.format)}
                            inputMode={field.format === 'number' ? 'decimal' : undefined}
                            value={templateBodyValues[idx] || ''}
                            onChange={(e) => {
                              const next = [...templateBodyValues];
                              next[idx] = e.target.value;
                              setTemplateBodyValues(next);
                              setTemplateFormError('');
                            }}
                            placeholder={
                              field.example
                                ? `e.g. ${field.example}`
                                : `Enter ${field.formatLabel.toLowerCase()} for {{${field.token}}}`
                            }
                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-[#075E54] focus:outline-none"
                          />
                        </div>
                      ))}

                      {selectedTemplateSchema.buttonUrlField && (
                        <div className="sm:col-span-2">
                          <div className="flex items-center justify-between gap-2">
                            <label
                              htmlFor="tpl-btn-url"
                              className="text-[11px] font-semibold text-slate-800"
                            >
                              {selectedTemplateSchema.buttonUrlField.label}
                            </label>
                            <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#075E54] border border-slate-200">
                              Link
                            </span>
                          </div>
                          <input
                            id="tpl-btn-url"
                            type="text"
                            value={templateButtonValue}
                            onChange={(e) => {
                              setTemplateButtonValue(e.target.value);
                              setTemplateFormError('');
                            }}
                            placeholder="Enter dynamic URL suffix parameter"
                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-[#075E54] focus:outline-none"
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Locked Approved Message Preview */}
                  <div className="rounded-lg border border-emerald-200/80 bg-white p-2.5 text-xs">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      Approved Meta Message Preview
                    </p>
                    {selectedTemplatePreview?.headerPreview && (
                      <p className="mt-1 font-semibold text-slate-900">
                        {selectedTemplatePreview.headerPreview}
                      </p>
                    )}
                    <p className="mt-1 whitespace-pre-wrap leading-relaxed text-slate-800">
                      {selectedTemplatePreview?.bodyPreview}
                    </p>
                  </div>

                  {templateFormError && (
                    <p className="text-xs font-medium text-red-700" role="alert">
                      {templateFormError}
                    </p>
                  )}

                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setShowTemplatePicker(true)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Switch Template
                    </button>
                    <button
                      type="button"
                      disabled={isSending}
                      onClick={() => void handleSend()}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#075E54] px-4 py-2 text-xs font-semibold text-white hover:bg-[#064c44] disabled:opacity-50"
                    >
                      <Send className="h-3.5 w-3.5" />
                      <span>{isSending ? 'Dispatching...' : 'Send Approved Template'}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Pending Attachment Bar (Free-Form Reply) */}
                  {pendingAttachment && (
                    <div className="mb-2.5 flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs">
                      <div className="flex min-w-0 items-center gap-2 text-emerald-950">
                        {pendingAttachment.kind === 'image' ? (
                          <ImageIcon className="h-4 w-4 shrink-0 text-[#075E54]" />
                        ) : pendingAttachment.kind === 'video' ? (
                          <Video className="h-4 w-4 shrink-0 text-[#075E54]" />
                        ) : pendingAttachment.kind === 'audio' ? (
                          <Music className="h-4 w-4 shrink-0 text-[#075E54]" />
                        ) : (
                          <FileText className="h-4 w-4 shrink-0 text-[#075E54]" />
                        )}
                        <span className="truncate font-medium">{pendingAttachment.name}</span>
                        <span className="shrink-0 font-mono text-[11px] uppercase text-slate-500">
                          {pendingAttachment.kind}
                        </span>
                        {pendingAttachment.driveFileId && (
                          <span className="shrink-0 text-emerald-700">· Stored in Drive</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setPendingAttachment(null);
                          setPendingLocalFile(null);
                        }}
                        aria-label="Remove attachment"
                        className="rounded p-1 text-emerald-800 hover:bg-emerald-100"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}

                  {/* Clean Composer Bar: Universal Attachment + Approved Meta Templates + Textarea + Send */}
                  <div className="flex items-end gap-1.5 sm:gap-2">
                    <button
                      type="button"
                      onClick={() => setShowAttachModal(true)}
                      aria-label="Attach photo, video, PDF, audio, or any file"
                      title="Attach Photo, Video, PDF, Audio, or File"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                    >
                      <Paperclip className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowTemplatePicker((prev) => !prev)}
                      aria-label="Select pre-approved Meta template"
                      title="Pre-Approved Meta Templates"
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                        showTemplatePicker
                          ? 'border-emerald-200 bg-emerald-50 text-[#075E54]'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                      }`}
                    >
                      <Sparkles className="h-4 w-4" />
                    </button>

                    <textarea
                      rows={1}
                      value={draftText}
                      disabled={isFreeFormLocked}
                      onChange={(e) => setDraftText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void handleSend();
                        }
                      }}
                      placeholder={
                        isFreeFormLocked
                          ? '24h window expired — select an Approved Template to message...'
                          : `Reply to ${activeContact.name}...`
                      }
                      aria-label="Type a WhatsApp reply"
                      className="max-h-32 min-h-[40px] flex-1 resize-none rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#075E54] focus:bg-white focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                    />

                    <button
                      type="button"
                      onClick={() => void handleSend()}
                      disabled={
                        isSending || isFreeFormLocked || (!draftText.trim() && !pendingAttachment)
                      }
                      className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#075E54] px-4 text-sm font-medium text-white transition-colors hover:bg-[#064c44] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      <Send className="h-4 w-4" />
                      <span className="hidden sm:inline">{isSending ? 'Sending' : 'Send'}</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center bg-slate-50 p-8 text-center">
            <h2 className="text-lg font-semibold text-slate-900">Select a conversation</h2>
            <p className="mt-1 max-w-sm text-sm text-slate-500">
              Choose a contact on the left or start a new WhatsApp message.
            </p>
          </div>
        )}
      </section>

      {/* Pane 3: Contact CRM Inspector */}
      {showInfoPanel && activeContact && (
        <aside
          aria-label="Contact CRM details"
          className="hidden w-[296px] shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white xl:flex"
        >
          <div className="border-b border-slate-200 p-5">
            <div className="flex items-center gap-3">
              {activeContact.avatarUrl ? (
                <img
                  src={activeContact.avatarUrl}
                  alt={activeContact.name}
                  referrerPolicy="no-referrer"
                  className="h-12 w-12 rounded-full object-cover border border-slate-200"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-sm font-semibold text-[#075E54]">
                  {getInitials(activeContact.name)}
                </div>
              )}
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-slate-900">
                  {activeContact.name}
                </h3>
                <p className="truncate font-mono text-xs text-slate-500 tabular-nums">
                  {formatPhoneDisplay(activeContact.phone)}
                </p>
              </div>
            </div>
            <div className="mt-3 space-y-1 text-xs text-slate-600">
              {activeContact.company && <p>{activeContact.company}</p>}
              {activeContact.email && <p className="text-slate-500">{activeContact.email}</p>}
            </div>
          </div>

          <div className="space-y-5 p-5">
            {/* Tags */}
            <div>
              <h4 className="text-xs font-semibold text-slate-900">Contact Segments</h4>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {activeContact.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700"
                  >
                    <span>{tag}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      aria-label={`Remove tag ${tag}`}
                      className="text-slate-400 hover:text-slate-700"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="mt-2 flex gap-1.5">
                <input
                  type="text"
                  value={newTagInput}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                  placeholder="Add tag..."
                  aria-label="Add contact tag"
                  className="min-w-0 flex-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs focus:border-[#075E54] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleAddTag}
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Custom Sheet Merge Attributes */}
            <div className="space-y-3 border-t border-slate-100 pt-4">
              <h4 className="text-xs font-semibold text-slate-900">
                Sheet Merge Fields
              </h4>
              <div>
                <label
                  htmlFor="crm-custom1"
                  className="block text-[11px] font-medium text-slate-500"
                >
                  Order / Reference (&#123;&#123;custom1&#125;&#125;)
                </label>
                <input
                  id="crm-custom1"
                  type="text"
                  value={custom1Draft}
                  onChange={(e) => setCustom1Draft(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-[#075E54] focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="crm-custom2"
                  className="block text-[11px] font-medium text-slate-500"
                >
                  City / Attribute (&#123;&#123;custom2&#125;&#125;)
                </label>
                <input
                  id="crm-custom2"
                  type="text"
                  value={custom2Draft}
                  onChange={(e) => setCustom2Draft(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-900 focus:border-[#075E54] focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="crm-notes"
                  className="block text-[11px] font-medium text-slate-500"
                >
                  Internal Notes
                </label>
                <textarea
                  id="crm-notes"
                  rows={3}
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-900 focus:border-[#075E54] focus:outline-none"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={handleSaveCrmDetails}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
                >
                  Save Details
                </button>
                {crmSavedNotice && (
                  <span className="text-xs font-medium text-[#075E54]">Saved</span>
                )}
              </div>
            </div>

            {activeContact.attachmentName && (
              <div className="border-t border-slate-100 pt-4">
                <h4 className="text-xs font-semibold text-slate-900">
                  Assigned Custom Attachment
                </h4>
                <p className="mt-1 truncate text-xs text-slate-600">
                  {activeContact.attachmentName}
                </p>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* Modal: New Chat */}
      {showNewChatModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-chat-title"
        >
          <form
            onSubmit={handleCreateNewChat}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h3 id="new-chat-title" className="text-base font-semibold text-slate-900">
                Start New WhatsApp Chat
              </h3>
              <button
                type="button"
                onClick={() => setShowNewChatModal(false)}
                aria-label="Close new chat dialog"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3.5">
              <div>
                <label htmlFor="new-chat-phone" className="block text-xs font-medium text-slate-700">
                  WhatsApp Number (E.164 or 10-digit)
                </label>
                <input
                  id="new-chat-phone"
                  type="tel"
                  required
                  value={newChatPhone}
                  onChange={(e) => setNewChatPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm focus:border-[#075E54] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="new-chat-name" className="block text-xs font-medium text-slate-700">
                    Contact Name
                  </label>
                  <input
                    id="new-chat-name"
                    type="text"
                    value={newChatName}
                    onChange={(e) => setNewChatName(e.target.value)}
                    placeholder="e.g. Neha Kulkarni"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#075E54] focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="new-chat-company" className="block text-xs font-medium text-slate-700">
                    Company
                  </label>
                  <input
                    id="new-chat-company"
                    type="text"
                    value={newChatCompany}
                    onChange={(e) => setNewChatCompany(e.target.value)}
                    placeholder="Optional"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#075E54] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="new-chat-msg" className="block text-xs font-medium text-slate-700">
                  Opening Message
                </label>
                <textarea
                  id="new-chat-msg"
                  rows={3}
                  required
                  value={newChatMessage}
                  onChange={(e) => setNewChatMessage(e.target.value)}
                  placeholder="Hello! Reaching out from SNC Whats App regarding your inquiry..."
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#075E54] focus:outline-none"
                />
              </div>

              {newChatError && (
                <p className="text-xs font-medium text-red-600" role="alert">
                  {newChatError}
                </p>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowNewChatModal(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-[#075E54] px-4 py-2 text-sm font-medium text-white hover:bg-[#064c44]"
              >
                Send & Open Chat
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Universal Attachment Picker (Photos, Videos, PDFs, Documents, Audio & All Files) */}
      {showAttachModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="attach-modal-title"
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 id="attach-modal-title" className="text-base font-semibold text-slate-900">
                Attach Photo, Video, PDF, Audio, or Any File
              </h3>
              <button
                type="button"
                onClick={() => setShowAttachModal(false)}
                aria-label="Close attachment modal"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-5">
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="*/*"
                  onChange={(e) => void handleLocalFileChange(e.target.files?.[0])}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={isUploadingDrive}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm font-medium text-slate-700 transition-colors hover:border-[#075E54] hover:bg-emerald-50/40"
                >
                  <div className="flex items-center gap-2">
                    <Upload className="h-4 w-4 text-[#075E54]" />
                    <span>
                      {isUploadingDrive
                        ? 'Uploading to SNC Google Drive...'
                        : gatewayConfigured
                          ? 'Upload Any File (Auto-Saves to Google Drive)'
                          : 'Select Photo, Video, PDF, Audio, or Document'}
                    </span>
                  </div>
                  <span className="text-[11px] font-normal text-slate-500">
                    Supports Photos (JPG, PNG, WEBP), Videos (MP4), PDFs, Word, Excel, Audio (MP3/OGG), and other files
                  </span>
                </button>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-slate-700">
                  SNC Google Drive Attachments Library
                </h4>
                <div className="mt-2 max-h-40 space-y-1.5 overflow-y-auto">
                  {driveFiles.length === 0 ? (
                    <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-center text-xs text-slate-500">
                      No Drive files synced yet. Upload a file above or refresh Drive Media.
                    </p>
                  ) : (
                    driveFiles.map((file) => (
                      <button
                        key={file.id}
                        type="button"
                        onClick={() => handleSelectDriveFile(file)}
                        className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-left text-xs transition-colors hover:border-[#075E54] hover:bg-emerald-50/40"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {file.kind === 'image' ? (
                            <ImageIcon className="h-4 w-4 shrink-0 text-[#075E54]" />
                          ) : file.kind === 'video' ? (
                            <Video className="h-4 w-4 shrink-0 text-[#075E54]" />
                          ) : file.kind === 'audio' ? (
                            <Music className="h-4 w-4 shrink-0 text-[#075E54]" />
                          ) : (
                            <FileText className="h-4 w-4 shrink-0 text-[#075E54]" />
                          )}
                          <span className="truncate font-medium text-slate-900">{file.name}</span>
                        </span>
                        <span className="shrink-0 font-mono text-slate-500 tabular-nums">
                          {file.kind.toUpperCase()} · {formatFileSize(file.sizeBytes)}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <h4 className="text-xs font-semibold text-slate-700">
                  Or Attach via Public HTTPS or Google Drive URL
                </h4>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    type="url"
                    value={attachUrlInput}
                    onChange={(e) => setAttachUrlInput(e.target.value)}
                    placeholder="https://drive.google.com/file/d/..."
                    aria-label="Attachment HTTPS URL"
                    className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[#075E54] focus:outline-none"
                  />
                  <input
                    type="text"
                    value={attachNameInput}
                    onChange={(e) => setAttachNameInput(e.target.value)}
                    placeholder="Display filename (e.g. Bill.pdf)"
                    aria-label="Attachment display filename"
                    className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[#075E54] focus:outline-none"
                  />
                </div>
                {attachError && (
                  <p className="mt-1.5 text-xs font-medium text-red-600">{attachError}</p>
                )}
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={handleAttachHttpsUrl}
                    className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800"
                  >
                    Attach URL
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
