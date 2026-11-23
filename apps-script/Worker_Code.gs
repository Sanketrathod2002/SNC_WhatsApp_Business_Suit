/**
 * ============================================================================
 * SNC WhatsApp Business — Worker_Code.gs (Background Queue, Sharding & Backup Engine)
 * ============================================================================
 * Reads SPREADSHEET_ID and DRIVE_FOLDER_ID strictly from Apps Script Script Properties.
 *
 * Triggers to install (run installWorkerTriggers() once):
 *   1. processBulkQueueBatch  -> Every 1 minute (bypasses Google 6-min execution limit)
 *   2. checkAndRotateShard    -> Daily at 02:00 AM (shards Message_Logs > 30,000 rows)
 *   3. nightlyWorkspaceBackup -> Daily at 03:00 AM (14-day rolling Drive backup)
 */

const WORKER_CONFIG = {
  DEFAULT_DRIVE_FOLDER_ID: '',
  BATCH_SIZE_PER_MINUTE: 25,
  THROTTLE_MS: 1200,
  DAILY_TIER_LIMIT: 1000,
  QUOTA_GUARDRAIL_RATIO: 0.85,
  SHARD_THRESHOLD_ROWS: 30000,
  SHARD_ARCHIVE_BATCH: 25000,
  BACKUP_RETENTION_DAYS: 14,
};

function getWorkerSpreadsheet_() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  const ssId = String(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '').trim();
  if (ssId) return SpreadsheetApp.openById(ssId);
  throw new Error('Set SPREADSHEET_ID in Script Properties.');
}

function getWorkerRootFolder_() {
  const props = PropertiesService.getScriptProperties();
  const folderId = String(
    props.getProperty('DRIVE_FOLDER_ID') ||
      WORKER_CONFIG.DEFAULT_DRIVE_FOLDER_ID ||
      ''
  ).trim();
  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (e) {
      // Fall through to parent folder auto-detection
    }
  }
  const ss = getWorkerSpreadsheet_();
  const parents = DriveApp.getFileById(ss.getId()).getParents();
  if (parents.hasNext()) {
    const parent = parents.next();
    props.setProperty('DRIVE_FOLDER_ID', parent.getId());
    return parent;
  }
  const found = DriveApp.getFoldersByName('SNC Whats App');
  const created = found.hasNext() ? found.next() : DriveApp.createFolder('SNC Whats App');
  props.setProperty('DRIVE_FOLDER_ID', created.getId());
  return created;
}

function installWorkerTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const fn = t.getHandlerFunction();
    if (
      fn === 'processBulkQueueBatch' ||
      fn === 'checkAndRotateShard' ||
      fn === 'nightlyWorkspaceBackup'
    ) {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('processBulkQueueBatch').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('checkAndRotateShard').timeBased().atHour(2).everyDays(1).create();
  ScriptApp.newTrigger('nightlyWorkspaceBackup').timeBased().atHour(3).everyDays(1).create();
  Logger.log('Installed all 3 SNC Worker triggers successfully.');
}

/**
 * 1-Minute Chunked Bulk Dispatch Worker with 85% Meta API Quota Guardrail & #opt_out filter.
 */
function processBulkQueueBatch() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;

  try {
    const props = PropertiesService.getScriptProperties();
    const todayKey = 'DAILY_SEND_COUNT_' + new Date().toISOString().slice(0, 10);
    let dailySent = Number(props.getProperty(todayKey) || 0);
    const maxSafeDaily = Math.floor(
      WORKER_CONFIG.DAILY_TIER_LIMIT * WORKER_CONFIG.QUOTA_GUARDRAIL_RATIO
    );
    if (dailySent >= maxSafeDaily) {
      Logger.log('85% Daily Quota Guardrail reached (' + dailySent + '/' + maxSafeDaily + '). Pausing until tomorrow.');
      return;
    }

    const ss = getWorkerSpreadsheet_();
    const queueSheet = ss.getSheetByName('Bulk_Queue');
    const logsSheet = ss.getSheetByName('Message_Logs');
    const contactsSheet = ss.getSheetByName('Contacts');
    if (!queueSheet || !logsSheet || queueSheet.getLastRow() < 2) return;

    // Build #opt_out phone set
    const optedOut = {};
    if (contactsSheet && contactsSheet.getLastRow() >= 2) {
      const cRows = contactsSheet.getDataRange().getValues();
      for (let c = 1; c < cRows.length; c++) {
        if (String(cRows[c][5] || '').indexOf('#opt_out') >= 0) {
          optedOut[String(cRows[c][2] || '').replace(/\D/g, '')] = true;
        }
      }
    }

    const values = queueSheet.getDataRange().getValues();
    let processed = 0;

    for (let i = 1; i < values.length; i++) {
      if (processed >= WORKER_CONFIG.BATCH_SIZE_PER_MINUTE) break;
      if (dailySent >= maxSafeDaily) break;

      const row = values[i];
      if (String(row[9] || '').toUpperCase() !== 'PENDING') continue;

      const campaignId = String(row[1] || 'worker_bulk');
      const phone = String(row[2] || '').replace(/\D/g, '');
      const name = String(row[3] || 'Customer');
      const message = String(row[4] || '');
      const templateName = String(row[5] || '');
      const attUrl = String(row[6] || '');
      const attType = String(row[7] || 'document').toLowerCase();
      const attName = String(row[8] || '');
      const now = new Date().toISOString();

      if (optedOut[phone]) {
        queueSheet.getRange(i + 1, 10, 1, 4).setValues([['SKIPPED_OPT_OUT', '', now, 'Contact has #opt_out tag']]);
        continue;
      }

      try {
        const res = sendWhatsAppMessage({
          to: phone,
          type: templateName ? 'template' : attUrl ? attType : 'text',
          body: message,
          templateName: templateName || undefined,
          attachmentUrl: attUrl || undefined,
          attachmentName: attName || undefined,
        });
        queueSheet.getRange(i + 1, 10, 1, 4).setValues([['SENT', res.waMessageId, now, '']]);
        logsSheet.appendRow([
          'wrk_' + new Date().getTime() + '_' + i, now, 'outbound', phone, name,
          templateName ? 'template' : attUrl ? attType : 'text', message, attName, attUrl,
          'sent', campaignId, res.waMessageId, 'Worker_Bulk_Queue', templateName, 'UTILITY',
          '', '', '', 'true', '', '', '',
        ]);
        dailySent++;
        processed++;
        props.setProperty(todayKey, String(dailySent));
      } catch (err) {
        queueSheet.getRange(i + 1, 10, 1, 4).setValues([['FAILED', '', now, String(err.message || err)]]);
        processed++;
      }

      Utilities.sleep(WORKER_CONFIG.THROTTLE_MS);
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * Auto-Sharding Engine: archives oldest 25,000 rows once Message_Logs exceeds 30,000 rows.
 */
function checkAndRotateShard() {
  const ss = getWorkerSpreadsheet_();
  const logsSheet = ss.getSheetByName('Message_Logs');
  const registrySheet = ss.getSheetByName('Shards_Registry');
  if (!logsSheet || !registrySheet) return;

  const totalRows = logsSheet.getLastRow() - 1;
  if (totalRows <= WORKER_CONFIG.SHARD_THRESHOLD_ROWS) return;

  const root = getWorkerRootFolder_();
  const shardsIter = root.getFoldersByName('Message_Shards');
  const shardsFolder = shardsIter.hasNext() ? shardsIter.next() : root.createFolder('Message_Shards');

  const archiveCount = Math.min(WORKER_CONFIG.SHARD_ARCHIVE_BATCH, totalRows - 1000);
  const cols = logsSheet.getLastColumn();
  const headers = logsSheet.getRange(1, 1, 1, cols).getValues();
  const archiveData = logsSheet.getRange(2, 1, archiveCount, cols).getValues();

  const firstDate = String(archiveData[0][1] || '').slice(0, 10);
  const lastDate = String(archiveData[archiveData.length - 1][1] || '').slice(0, 10);
  const shardId = 'SNC_Shard_' + new Date().toISOString().slice(0, 10) + '_' + new Date().getTime();

  const shardSs = SpreadsheetApp.create(shardId);
  const shardTab = shardSs.getSheets()[0];
  shardTab.setName('Message_Logs_Archive');
  shardTab.getRange(1, 1, 1, cols).setValues(headers);
  shardTab.getRange(2, 1, archiveCount, cols).setValues(archiveData);
  DriveApp.getFileById(shardSs.getId()).moveTo(shardsFolder);

  logsSheet.deleteRows(2, archiveCount);
  registrySheet.appendRow([
    shardId,
    shardSs.getId(),
    shardSs.getUrl(),
    archiveCount,
    new Date().toISOString(),
    firstDate + ' to ' + lastDate,
  ]);
}

/**
 * Nightly Automated Backup with 14-day rolling retention in Google Drive.
 */
function nightlyWorkspaceBackup() {
  const ss = getWorkerSpreadsheet_();
  const root = getWorkerRootFolder_();
  const bIter = root.getFoldersByName('Nightly_Backups');
  const backupFolder = bIter.hasNext() ? bIter.next() : root.createFolder('Nightly_Backups');

  const masterFile = DriveApp.getFileById(ss.getId());
  const stamp = new Date().toISOString().slice(0, 10);
  masterFile.makeCopy('SNC_Master_Backup_' + stamp, backupFolder);

  const cutoffMs = Date.now() - WORKER_CONFIG.BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const files = backupFolder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    if (f.getDateCreated().getTime() < cutoffMs) {
      f.setTrashed(true);
    }
  }
}
