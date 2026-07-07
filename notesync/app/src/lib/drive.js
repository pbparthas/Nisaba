// Minimal Google Drive v3 client over fetch. Only touches files this app
// created (drive.file scope). Layout in the user's Drive:
//   NoteSync/items.json                     — all notes & tasks
//   NoteSync/attachments/<attId>__<name>    — one file per image/attachment
//
// `getToken` is injected (browser: GIS token client; desktop: loopback OAuth).
// `baseUrl` is injectable so tests can point at a mock server.

const FOLDER_MIME = 'application/vnd.google-apps.folder';

export function createDriveClient({ getToken, baseUrl = 'https://www.googleapis.com' }) {
  let folderId = null;
  let attachmentsFolderId = null;
  let itemsFileId = null;

  async function call(path, { method = 'GET', query, body, headers = {}, raw = false } = {}) {
    const url = new URL(baseUrl + path);
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
    const token = await getToken();
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...headers },
      body,
    });
    if (res.status === 401) throw Object.assign(new Error('unauthorized'), { code: 401 });
    if (!res.ok) throw new Error(`Drive ${method} ${path}: ${res.status} ${await res.text()}`);
    return raw ? res : res.json();
  }

  async function findOne(q) {
    const data = await call('/drive/v3/files', {
      query: { q, fields: 'files(id, name)', pageSize: '1', spaces: 'drive' },
    });
    return data.files[0] || null;
  }

  async function createFolder(name, parentId) {
    const data = await call('/drive/v3/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: parentId ? [parentId] : [] }),
    });
    return data.id;
  }

  function multipart(metadata, content, mime) {
    const boundary = 'notesync-' + Math.random().toString(36).slice(2);
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
      content,
      `\r\n--${boundary}--`,
    ]);
    return { body, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` } };
  }

  return {
    // Locate or create the NoteSync folder structure; cache IDs for the session.
    async ensureSetup() {
      if (folderId) return;
      const folder = await findOne(`name = 'NoteSync' and mimeType = '${FOLDER_MIME}' and trashed = false`);
      folderId = folder ? folder.id : await createFolder('NoteSync');
      const att = await findOne(`name = 'attachments' and mimeType = '${FOLDER_MIME}' and '${folderId}' in parents and trashed = false`);
      attachmentsFolderId = att ? att.id : await createFolder('attachments', folderId);
      const items = await findOne(`name = 'items.json' and '${folderId}' in parents and trashed = false`);
      itemsFileId = items ? items.id : null;
    },

    // Cheap change probe: version increments on every write to items.json.
    async getItemsVersion() {
      await this.ensureSetup();
      if (!itemsFileId) return null;
      const data = await call(`/drive/v3/files/${itemsFileId}`, { query: { fields: 'version' } });
      return data.version;
    },

    async downloadItems() {
      await this.ensureSetup();
      if (!itemsFileId) return null;
      return call(`/drive/v3/files/${itemsFileId}`, { query: { alt: 'media' } });
    },

    async uploadItems(doc) {
      await this.ensureSetup();
      const json = JSON.stringify(doc);
      let data;
      if (itemsFileId) {
        const { body, headers } = multipart({}, json, 'application/json');
        data = await call(`/upload/drive/v3/files/${itemsFileId}`, {
          method: 'PATCH', query: { uploadType: 'multipart', fields: 'id, version' }, body, headers,
        });
      } else {
        const { body, headers } = multipart(
          { name: 'items.json', parents: [folderId] }, json, 'application/json'
        );
        data = await call('/upload/drive/v3/files', {
          method: 'POST', query: { uploadType: 'multipart', fields: 'id, version' }, body, headers,
        });
        itemsFileId = data.id;
      }
      return data.version;
    },

    async uploadAttachment(attId, name, blob) {
      await this.ensureSetup();
      const { body, headers } = multipart(
        { name: `${attId}__${name}`, parents: [attachmentsFolderId] },
        blob, blob.type || 'application/octet-stream'
      );
      await call('/upload/drive/v3/files', {
        method: 'POST', query: { uploadType: 'multipart', fields: 'id' }, body, headers,
      });
    },

    // Which attachment IDs already exist in Drive? (names are `<attId>__<orig>`)
    async listAttachmentIds() {
      await this.ensureSetup();
      const ids = new Map();
      let pageToken;
      do {
        const data = await call('/drive/v3/files', {
          query: {
            q: `'${attachmentsFolderId}' in parents and trashed = false`,
            fields: 'nextPageToken, files(id, name)', pageSize: '1000',
            ...(pageToken ? { pageToken } : {}),
          },
        });
        for (const f of data.files) ids.set(f.name.split('__')[0], f.id);
        pageToken = data.nextPageToken;
      } while (pageToken);
      return ids;
    },

    async downloadAttachment(driveFileId) {
      const res = await call(`/drive/v3/files/${driveFileId}`, { query: { alt: 'media' }, raw: true });
      return res.blob();
    },

    async getUserEmail() {
      const data = await call('/drive/v3/about', { query: { fields: 'user(emailAddress)' } });
      return data.user.emailAddress;
    },
  };
}
