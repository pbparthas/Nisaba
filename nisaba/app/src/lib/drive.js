// Minimal Google Drive v3 client over fetch. Only touches files this app
// created (drive.file scope). Layout in the user's Drive (plan v2 — one file
// per item so concurrent offline edits only ever collide on the item actually
// edited on both sides):
//   Nisaba/schema.json                     — data-format version (sync guard)
//   Nisaba/items/<itemId>.json             — one note or task per file
//   Nisaba/attachments/<attId>__<name>     — one file per image/attachment
//
// `getToken` is injected (browser: GIS token client; desktop: loopback OAuth).
// `baseUrl` is injectable so tests can point at a mock server.

const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const SCHEMA_VERSION = 1;

export function createDriveClient({ getToken, baseUrl = 'https://www.googleapis.com' }) {
  let folderId = null;
  let itemsFolderId = null;
  let attachmentsFolderId = null;

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

  async function list(q, fields = 'files(id, name)') {
    const out = [];
    let pageToken;
    do {
      const data = await call('/drive/v3/files', {
        query: {
          q, fields: `nextPageToken, ${fields}`, pageSize: '1000', spaces: 'drive',
          ...(pageToken ? { pageToken } : {}),
        },
      });
      out.push(...data.files);
      pageToken = data.nextPageToken;
    } while (pageToken);
    return out;
  }

  async function findOne(q) {
    return (await list(q))[0] || null;
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
    const boundary = 'nisaba-' + Math.random().toString(36).slice(2);
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
      content,
      `\r\n--${boundary}--`,
    ]);
    return { body, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` } };
  }

  async function uploadJson(name, parentId, obj, existingFileId) {
    const json = JSON.stringify(obj);
    if (existingFileId) {
      const { body, headers } = multipart({}, json, 'application/json');
      return call(`/upload/drive/v3/files/${existingFileId}`, {
        method: 'PATCH', query: { uploadType: 'multipart', fields: 'id, md5Checksum, version' }, body, headers,
      });
    }
    const { body, headers } = multipart({ name, parents: [parentId] }, json, 'application/json');
    return call('/upload/drive/v3/files', {
      method: 'POST', query: { uploadType: 'multipart', fields: 'id, md5Checksum, version' }, body, headers,
    });
  }

  return {
    // Locate or create the folder structure; enforce the schema guard so an
    // outdated app version never scribbles over a newer data format.
    async ensureSetup() {
      if (folderId) return;
      const folder = await findOne(`name = 'Nisaba' and mimeType = '${FOLDER_MIME}' and trashed = false`);
      folderId = folder ? folder.id : await createFolder('Nisaba');
      const [items, atts, schema] = await Promise.all([
        findOne(`name = 'items' and mimeType = '${FOLDER_MIME}' and '${folderId}' in parents and trashed = false`),
        findOne(`name = 'attachments' and mimeType = '${FOLDER_MIME}' and '${folderId}' in parents and trashed = false`),
        findOne(`name = 'schema.json' and '${folderId}' in parents and trashed = false`),
      ]);
      itemsFolderId = items ? items.id : await createFolder('items', folderId);
      attachmentsFolderId = atts ? atts.id : await createFolder('attachments', folderId);
      if (schema) {
        const remote = await call(`/drive/v3/files/${schema.id}`, { query: { alt: 'media' } });
        if (remote.schema > SCHEMA_VERSION) {
          throw Object.assign(new Error('Drive data uses a newer format — update the app on this device'), { code: 'schema' });
        }
      } else {
        await uploadJson('schema.json', folderId, { schema: SCHEMA_VERSION });
      }
    },

    // The item listing doubles as the sync manifest: itemId -> {fileId, version}.
    async listItems() {
      await this.ensureSetup();
      const files = await list(
        `'${itemsFolderId}' in parents and trashed = false`,
        'files(id, name, md5Checksum, version)'
      );
      const map = new Map();
      for (const f of files) {
        // Prefer the content hash (stable — only moves when the bytes change)
        // over Drive's `version` field, which Drive bumps on its own after an
        // upload and would otherwise re-trigger a pull + spurious conflict copy.
        if (f.name.endsWith('.json')) map.set(f.name.slice(0, -5), { fileId: f.id, version: String(f.md5Checksum || f.version) });
      }
      return map;
    },

    async downloadItem(fileId) {
      return call(`/drive/v3/files/${fileId}`, { query: { alt: 'media' } });
    },

    async uploadItem(item, existingFileId) {
      await this.ensureSetup();
      const data = await uploadJson(`${item.id}.json`, itemsFolderId, item, existingFileId);
      return { fileId: data.id, version: String(data.md5Checksum || data.version) };
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
      const files = await list(`'${attachmentsFolderId}' in parents and trashed = false`);
      return new Map(files.map((f) => [f.name.split('__')[0], f.id]));
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
