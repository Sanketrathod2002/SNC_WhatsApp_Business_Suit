import { useMemo, useRef, useState } from 'react';
import {
  Download,
  FileSpreadsheet,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { ConfirmationRequest, Contact } from '../types';
import {
  contactsToCsv,
  formatPhoneDisplay,
  isSafeHttpsUrl,
  isValidPhone,
  normalizePhone,
  parseCsvContacts,
  SAMPLE_CONTACTS_CSV,
} from '../utils/whatsappLogic';

interface ContactsViewProps {
  contacts: Contact[];
  defaultCountryCode: string;
  gatewayConfigured: boolean;
  hasMasterSheet: boolean;
  onSaveContact: (contact: Contact) => void;
  onDeleteContact: (contactId: string) => void;
  onImportContacts: (newContacts: Contact[]) => void;
  onOpenChatWithContact: (contactId: string) => void;
  onSyncContactsToSheet: () => void;
  onImportFromGoogleSheet: (sheetUrlOrId: string) => Promise<number>;
  onRequestConfirmation: (req: ConfirmationRequest) => void;
}

const EMPTY_FORM = {
  id: '',
  name: '',
  phone: '',
  email: '',
  company: '',
  tags: '',
  custom1: '',
  custom2: '',
  attachmentUrl: '',
  attachmentName: '',
  notes: '',
};

export function ContactsView({
  contacts,
  defaultCountryCode,
  gatewayConfigured,
  hasMasterSheet,
  onSaveContact,
  onDeleteContact,
  onImportContacts,
  onOpenChatWithContact,
  onSyncContactsToSheet,
  onImportFromGoogleSheet,
  onRequestConfirmation,
}: ContactsViewProps) {
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('ALL');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [sheetUrl, setSheetUrl] = useState('');
  const [notice, setNotice] = useState('');
  const csvInputRef = useRef<HTMLInputElement | null>(null);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    contacts.forEach((c) => c.tags.forEach((t) => s.add(t)));
    return ['ALL', ...Array.from(s)];
  }, [contacts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (tagFilter !== 'ALL' && !c.tags.includes(tagFilter)) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.phone.includes(q.replace(/\D/g, '') || q) ||
        c.company.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.custom1.toLowerCase().includes(q)
      );
    });
  }, [contacts, search, tagFilter]);

  const openCreateModal = () => {
    setForm(EMPTY_FORM);
    setFormError('');
    setShowModal(true);
  };

  const openEditModal = (contact: Contact) => {
    setForm({
      id: contact.id,
      name: contact.name,
      phone: formatPhoneDisplay(contact.phone),
      email: contact.email,
      company: contact.company,
      tags: contact.tags.join(', '),
      custom1: contact.custom1,
      custom2: contact.custom2,
      attachmentUrl: contact.attachmentUrl,
      attachmentName: contact.attachmentName,
      notes: contact.notes,
    });
    setFormError('');
    setShowModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const normalized = normalizePhone(form.phone, defaultCountryCode);
    if (!form.name.trim()) {
      setFormError('Contact name is required.');
      return;
    }
    if (!isValidPhone(normalized)) {
      setFormError('Enter a valid WhatsApp phone number (7 to 15 digits).');
      return;
    }
    if (form.attachmentUrl.trim() && !isSafeHttpsUrl(form.attachmentUrl.trim())) {
      setFormError('Attachment URL must be a valid https:// link.');
      return;
    }

    const existing = contacts.find((c) => c.id === form.id);
    const saved: Contact = {
      id: form.id || `cnt-${Date.now()}`,
      name: form.name.trim(),
      phone: normalized,
      email: form.email.trim(),
      company: form.company.trim(),
      tags: form.tags
        .split(/[,;]/)
        .map((t) => t.trim())
        .filter(Boolean),
      status: existing?.status || 'open',
      assignedAgent: existing?.assignedAgent || 'Sanket Rathod',
      custom1: form.custom1.trim(),
      custom2: form.custom2.trim(),
      attachmentUrl: form.attachmentUrl.trim(),
      attachmentName: form.attachmentName.trim(),
      notes: form.notes.trim(),
      avatarUrl: existing?.avatarUrl,
      unreadCount: existing?.unreadCount || 0,
      lastMessagePreview: existing?.lastMessagePreview || 'Contact added to SNC CRM',
      lastMessageAt: existing?.lastMessageAt || new Date().toISOString(),
    };
    onSaveContact(saved);
    setShowModal(false);
    setNotice(form.id ? `Updated ${saved.name}.` : `Added ${saved.name} to SNC Contacts.`);
  };

  const handleDeleteClick = (contact: Contact) => {
    onRequestConfirmation({
      title: `Delete "${contact.name}"?`,
      description: `This removes ${contact.name} (${formatPhoneDisplay(
        contact.phone
      )}) from your local SNC Contacts directory.`,
      confirmLabel: 'Delete Contact',
      tone: 'danger',
      onConfirm: () => {
        onDeleteContact(contact.id);
        setNotice(`Removed ${contact.name}.`);
      },
    });
  };

  const handleCsvFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const res = parseCsvContacts(text, defaultCountryCode);
    if (res.contacts.length === 0) {
      setNotice('No valid contacts found. Ensure the CSV has a "Phone" or "WhatsApp" column.');
      return;
    }
    onImportContacts(res.contacts);
    setNotice(
      `Imported ${res.contacts.length} contact(s) from CSV${
        res.skippedRows > 0 ? ` (${res.skippedRows} duplicates/invalids skipped)` : ''
      }.`
    );
  };

  const handleExportCsv = () => {
    const csv = contactsToCsv(filtered);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `snc_whatsapp_contacts_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadSampleCsv = () => {
    const blob = new Blob([SAMPLE_CONTACTS_CSV], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sample_contacts_import_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePullSheet = async () => {
    if (!sheetUrl.trim()) {
      setNotice('Paste a Google Sheet URL or Spreadsheet ID to import contacts.');
      return;
    }
    try {
      const count = await onImportFromGoogleSheet(sheetUrl.trim());
      setNotice(`Imported ${count} contact(s) from Google Sheets.`);
      setSheetUrl('');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Unable to read Google Sheet.');
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-slate-50 px-4 py-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Contacts & CRM
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Manage WhatsApp contacts, customer attributes, and per-contact attachments.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void handleCsvFile(e.target.files?.[0])}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => csvInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Import CSV</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadSampleCsv}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5 text-[#075E54]" />
              <span>Sample CSV</span>
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export CSV</span>
            </button>
            {gatewayConfigured && hasMasterSheet && (
              <button
                type="button"
                onClick={onSyncContactsToSheet}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-medium text-[#075E54] hover:bg-emerald-100 whitespace-nowrap"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                <span>Sync Live Sheet</span>
              </button>
            )}
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#075E54] px-4 py-2 text-xs font-medium text-white hover:bg-[#064c44] whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Contact</span>
            </button>
          </div>
        </div>

        {/* Filter & Google Sheet Import Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-1 flex-wrap items-center gap-2 min-w-[240px]">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, phone, company, or order..."
                aria-label="Search contacts"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-xs text-slate-900 focus:border-[#075E54] focus:bg-white focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1">
              {allTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setTagFilter(tag)}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    tagFilter === tag
                      ? 'bg-[#075E54] text-white'
                      : 'bg-slate-100 text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
              placeholder="Google Sheet URL or ID..."
              aria-label="Google Sheet URL for contact import"
              className="w-48 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-[#075E54] focus:outline-none sm:w-56"
            />
            <button
              type="button"
              onClick={() => void handlePullSheet()}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              Pull Sheet
            </button>
          </div>
        </div>

        {notice && (
          <p className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-medium text-slate-700">
            {notice}
          </p>
        )}

        {/* High-Density Data Table */}
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 text-xs text-slate-500 tabular-nums">
            <span>
              Showing {filtered.length} of {contacts.length} contacts
            </span>
            <span>Sheet Tab: Contacts</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="px-5 py-3">Contact</th>
                  <th className="px-4 py-3">WhatsApp Number</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Segments</th>
                  <th className="px-4 py-3">Order / City</th>
                  <th className="px-4 py-3">Custom Attachment</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-sm text-slate-500">
                      No contacts match your current filter. Click &quot;Add Contact&quot; to create one.
                    </td>
                  </tr>
                ) : (
                  filtered.map((contact) => (
                    <tr key={contact.id} className="hover:bg-slate-50/70">
                      <td className="px-5 py-3">
                        <p className="font-medium text-slate-900">{contact.name}</p>
                        {contact.email && (
                          <p className="text-xs text-slate-400">{contact.email}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                        {formatPhoneDisplay(contact.phone)}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-700">
                        {contact.company || '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {contact.tags.length > 0 ? contact.tags.join(' · ') : '—'}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600 tabular-nums">
                        {[contact.custom1, contact.custom2].filter(Boolean).join(' / ') || '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 max-w-[180px] truncate">
                        {contact.attachmentName || (contact.attachmentUrl ? 'Linked URL' : '—')}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => onOpenChatWithContact(contact.id)}
                            aria-label={`Message ${contact.name}`}
                            className="rounded-md p-1.5 text-[#075E54] hover:bg-emerald-50"
                          >
                            <MessageSquare className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(contact)}
                            aria-label={`Edit ${contact.name}`}
                            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteClick(contact)}
                            aria-label={`Delete ${contact.name}`}
                            className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Add / Edit Contact Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="contact-modal-title"
        >
          <form
            onSubmit={handleSubmit}
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 id="contact-modal-title" className="text-base font-semibold text-slate-900">
                {form.id ? 'Edit Contact' : 'Add New Contact'}
              </h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                aria-label="Close contact dialog"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <div>
                <label htmlFor="cnt-name" className="block text-xs font-medium text-slate-700">
                  Full Name *
                </label>
                <input
                  id="cnt-name"
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#075E54] focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="cnt-phone" className="block text-xs font-medium text-slate-700">
                  WhatsApp Number *
                </label>
                <input
                  id="cnt-phone"
                  type="tel"
                  required
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="+91 98201 12233"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm focus:border-[#075E54] focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="cnt-company" className="block text-xs font-medium text-slate-700">
                  Company
                </label>
                <input
                  id="cnt-company"
                  type="text"
                  value={form.company}
                  onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#075E54] focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="cnt-email" className="block text-xs font-medium text-slate-700">
                  Email
                </label>
                <input
                  id="cnt-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#075E54] focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="cnt-custom1" className="block text-xs font-medium text-slate-700">
                  Order / Ref (&#123;&#123;custom1&#125;&#125;)
                </label>
                <input
                  id="cnt-custom1"
                  type="text"
                  value={form.custom1}
                  onChange={(e) => setForm((f) => ({ ...f, custom1: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm focus:border-[#075E54] focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="cnt-custom2" className="block text-xs font-medium text-slate-700">
                  City / Field 2 (&#123;&#123;custom2&#125;&#125;)
                </label>
                <input
                  id="cnt-custom2"
                  type="text"
                  value={form.custom2}
                  onChange={(e) => setForm((f) => ({ ...f, custom2: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#075E54] focus:outline-none"
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="cnt-tags" className="block text-xs font-medium text-slate-700">
                  Tags (comma-separated)
                </label>
                <input
                  id="cnt-tags"
                  type="text"
                  value={form.tags}
                  onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                  placeholder="VIP, Wholesale, Mumbai"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#075E54] focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="cnt-att-url" className="block text-xs font-medium text-slate-700">
                  Custom Attachment HTTPS URL
                </label>
                <input
                  id="cnt-att-url"
                  type="url"
                  value={form.attachmentUrl}
                  onChange={(e) => setForm((f) => ({ ...f, attachmentUrl: e.target.value }))}
                  placeholder="https://drive.google.com/..."
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[#075E54] focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="cnt-att-name" className="block text-xs font-medium text-slate-700">
                  Attachment Filename
                </label>
                <input
                  id="cnt-att-name"
                  type="text"
                  value={form.attachmentName}
                  onChange={(e) => setForm((f) => ({ ...f, attachmentName: e.target.value }))}
                  placeholder="Invoice_102.pdf"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[#075E54] focus:outline-none"
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="cnt-notes" className="block text-xs font-medium text-slate-700">
                  Notes
                </label>
                <textarea
                  id="cnt-notes"
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#075E54] focus:outline-none"
                />
              </div>
            </div>

            {formError && (
              <p className="mt-3 text-xs font-medium text-red-600" role="alert">
                {formError}
              </p>
            )}

            <div className="mt-6 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-[#075E54] px-4 py-2 text-sm font-medium text-white hover:bg-[#064c44]"
              >
                {form.id ? 'Save Changes' : 'Create Contact'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
