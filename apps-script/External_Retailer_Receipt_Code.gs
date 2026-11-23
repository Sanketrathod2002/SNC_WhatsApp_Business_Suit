/**
 * ============================================================================
 * External Retailer Receipt Sheet — Drop-In WhatsApp Automation Script
 * ============================================================================
 * Zero Hardcoded Secrets: Store WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_ID,
 * and MASTER_GATEWAY_URL inside Project Settings -> Script Properties.
 */

const RETAILER_SHEET_CONFIG = {
  TAB_NAME: 'Receipt',
  TEMPLATE_NAME: 'retailer_receipt',
  API_VERSION: 'v25.0',
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Retailer Tools')
    .addItem('1. Configure Script Properties', 'configureRetailerToken')
    .addItem('2. Send Pending WhatsApps', 'processBulkWhatsApp')
    .addToUi();
}

function configureRetailerToken() {
  const ui = SpreadsheetApp.getUi();
  const tokenRes = ui.prompt('Meta WhatsApp Access Token', 'Paste your Meta Access Token:', ui.ButtonSet.OK_CANCEL);
  if (tokenRes.getSelectedButton() !== ui.Button.OK) return;
  const phoneRes = ui.prompt('Meta Phone Number ID', 'Enter your Meta Phone Number ID:', ui.ButtonSet.OK_CANCEL);
  if (phoneRes.getSelectedButton() !== ui.Button.OK) return;
  const gwRes = ui.prompt('Master Gateway /exec URL', 'Paste your deployed Gateway_Code.gs /exec URL:', ui.ButtonSet.OK_CANCEL);
  if (gwRes.getSelectedButton() !== ui.Button.OK) return;

  PropertiesService.getScriptProperties().setProperties({
    WHATSAPP_ACCESS_TOKEN: tokenRes.getResponseText().trim(),
    WHATSAPP_PHONE_ID: phoneRes.getResponseText().trim(),
    MASTER_GATEWAY_URL: gwRes.getResponseText().trim(),
  });
  ui.alert('Saved securely to Script Properties.');
}

function toDirectDriveDownloadUrl_(url) {
  const clean = String(url || '').trim();
  const match = clean.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return 'https://drive.usercontent.google.com/download?id=' + match[1] + '&export=download&authuser=0';
  }
  return clean;
}

function processBulkWhatsApp() {
  const props = PropertiesService.getScriptProperties();
  const token = String(props.getProperty('WHATSAPP_ACCESS_TOKEN') || '').trim();
  const phoneId = String(props.getProperty('WHATSAPP_PHONE_ID') || '').trim();
  const masterGatewayUrl = String(props.getProperty('MASTER_GATEWAY_URL') || '').trim();
  if (!token || !phoneId) {
    SpreadsheetApp.getUi().alert('Run "Retailer Tools -> 1. Configure Script Properties" first to save WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_ID, and MASTER_GATEWAY_URL.');
    return;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(RETAILER_SHEET_CONFIG.TAB_NAME);
  if (!sheet) throw new Error('Tab "' + RETAILER_SHEET_CONFIG.TAB_NAME + '" not found.');

  const data = sheet.getDataRange().getValues();
  let sentCount = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const receiptNo = String(row[0] || '').trim();
    const retailerName = String(row[1] || '').trim();
    const rawPhone = String(row[2] || '').replace(/\D/g, '');
    const pdfDriveUrl = String(row[3] || '').trim();
    const status = String(row[4] || '').trim().toUpperCase();

    if (!rawPhone || status === 'SENT') continue;
    const phone = rawPhone.length === 10 ? '91' + rawPhone : rawPhone;
    const directPdfUrl = toDirectDriveDownloadUrl_(pdfDriveUrl);

    try {
      const waId = sendRetailerReceiptMessage_(token, phoneId, phone, retailerName, receiptNo, directPdfUrl);
      sheet.getRange(i + 1, 5).setValue('SENT');
      sheet.getRange(i + 1, 6).setValue(waId);
      sheet.getRange(i + 1, 7).setValue(new Date().toISOString());

      // Push live delivery log to SNC Master Gateway when MASTER_GATEWAY_URL is set
      if (masterGatewayUrl) {
        UrlFetchApp.fetch(masterGatewayUrl, {
          method: 'post',
          contentType: 'text/plain;charset=utf-8',
          payload: JSON.stringify({
            action: 'logExternalSend',
            sourceSheetName: ss.getName(),
            phone: phone,
            contactName: retailerName,
            templateName: RETAILER_SHEET_CONFIG.TEMPLATE_NAME,
            category: 'UTILITY',
            receiptNo: receiptNo,
            attachmentName: 'Receipt_' + receiptNo + '.pdf',
            attachmentUrl: pdfDriveUrl || directPdfUrl,
            waMessageId: waId,
            status: 'sent',
            body: 'Retailer Receipt ' + receiptNo + ' dispatched via Google Sheet automation.',
            timestamp: new Date().toISOString(),
          }),
          muteHttpExceptions: true,
        });
      }

      sentCount++;
      Utilities.sleep(1000);
    } catch (err) {
      sheet.getRange(i + 1, 5).setValue('FAILED: ' + err.message);
    }
  }

  SpreadsheetApp.getUi().alert('Completed! Dispatched ' + sentCount + ' pending WhatsApp receipts.');
}

function uploadReceiptPdfToMeta_(token, phoneId, pdfUrl, filename) {
  try {
    const clean = String(pdfUrl || '').trim();
    const idMatch =
      clean.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/) ||
      clean.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    const blob =
      idMatch && idMatch[1]
        ? DriveApp.getFileById(idMatch[1]).getBlob()
        : UrlFetchApp.fetch(clean, { muteHttpExceptions: true }).getBlob();
    const safeName = String(filename || 'SNC_Receipt.pdf').replace(/[\r\n"]/g, '_');
    const boundary = 'SncReceiptBoundary_' + Utilities.getUuid().replace(/-/g, '');
    const crlf = '\r\n';
    let head = '';
    head += '--' + boundary + crlf;
    head += 'Content-Disposition: form-data; name="messaging_product"' + crlf + crlf;
    head += 'whatsapp' + crlf;
    head += '--' + boundary + crlf;
    head += 'Content-Disposition: form-data; name="type"' + crlf + crlf;
    head += 'application/pdf' + crlf;
    head += '--' + boundary + crlf;
    head += 'Content-Disposition: form-data; name="file"; filename="' + safeName + '"' + crlf;
    head += 'Content-Type: application/pdf' + crlf + crlf;
    const tail = crlf + '--' + boundary + '--' + crlf;
    const payloadBytes = Utilities.newBlob(head)
      .getBytes()
      .concat(blob.getBytes())
      .concat(Utilities.newBlob(tail).getBytes());

    const uploadRes = UrlFetchApp.fetch(
      'https://graph.facebook.com/' + RETAILER_SHEET_CONFIG.API_VERSION + '/' + phoneId + '/media',
      {
        method: 'post',
        contentType: 'multipart/form-data; boundary=' + boundary,
        headers: { Authorization: 'Bearer ' + token },
        payload: payloadBytes,
        muteHttpExceptions: true,
      }
    );
    const parsed = JSON.parse(uploadRes.getContentText() || '{}');
    if (uploadRes.getResponseCode() >= 200 && uploadRes.getResponseCode() < 300 && parsed.id) {
      return String(parsed.id);
    }
    Logger.log('Receipt PDF /media upload failed: ' + uploadRes.getContentText());
  } catch (err) {
    Logger.log('Receipt PDF /media upload error: ' + err.message);
  }
  return '';
}

function sendRetailerReceiptMessage_(token, phoneId, phone, retailerName, receiptNo, directPdfUrl) {
  const endpoint =
    'https://graph.facebook.com/' +
    RETAILER_SHEET_CONFIG.API_VERSION +
    '/' +
    phoneId +
    '/messages';

  const safeFilename = 'Receipt_' + receiptNo + '.pdf';
  const uploadedMediaId = uploadReceiptPdfToMeta_(token, phoneId, directPdfUrl, safeFilename);
  const documentParam = uploadedMediaId
    ? { id: uploadedMediaId, filename: safeFilename }
    : { link: directPdfUrl, filename: safeFilename };

  const payload = {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'template',
    template: {
      name: RETAILER_SHEET_CONFIG.TEMPLATE_NAME,
      language: { code: 'en_US' },
      components: [
        {
          type: 'header',
          parameters: [
            {
              type: 'document',
              document: documentParam,
            },
          ],
        },
        {
          type: 'body',
          parameters: [
            { type: 'text', text: retailerName },
            { type: 'text', text: receiptNo },
          ],
        },
      ],
    },
  };

  const res = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const parsed = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
    throw new Error((parsed.error && parsed.error.message) || 'Meta HTTP ' + res.getResponseCode());
  }
  return (parsed.messages && parsed.messages[0] && parsed.messages[0].id) || '';
}
