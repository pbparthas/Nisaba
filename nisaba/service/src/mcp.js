// MCP surface over the domain API — a zero-dependency implementation of the
// Model Context Protocol's JSON-RPC 2.0 methods, served as streamable HTTP by
// server.js at /mcp. Kept dependency-free on purpose (matches the Worker; one
// fewer supply-chain surface). Handles: initialize, tools/list, tools/call,
// ping, and the initialized notification.
//
// The tools are the point of the whole desktop phase — especially query_tasks,
// the agenda query generic note servers don't offer.

const PROTOCOL_VERSION = '2024-11-05';

const S = {
  string: (description) => ({ type: 'string', description }),
  date: (description) => ({ type: 'string', description: `${description} (YYYY-MM-DD)` }),
};

export function toolDefs() {
  return [
    {
      name: 'search_notes',
      description: 'Full-text search across the user\'s notes (title, body, tags). Returns matching notes newest-first, without full bodies.',
      inputSchema: {
        type: 'object',
        properties: { query: S.string('Text to search for; empty returns recent notes'), limit: { type: 'number', description: 'Max results (default 50)' } },
      },
    },
    {
      name: 'get_note',
      description: 'Fetch one note by id, including its full body (BlockNote block tree or plain text).',
      inputSchema: { type: 'object', properties: { id: S.string('Note id') }, required: ['id'] },
    },
    {
      name: 'create_note',
      description: 'Create a new note. Body may be a markdown/plain-text string or a BlockNote block-tree array.',
      inputSchema: {
        type: 'object',
        properties: {
          title: S.string('Note title'),
          body: { description: 'Note body: string or BlockNote blocks', type: ['string', 'array'] },
          tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags' },
        },
      },
    },
    {
      name: 'patch_note',
      description: 'Update a note\'s title, body and/or tags. Only the fields you pass change.',
      inputSchema: {
        type: 'object',
        properties: {
          id: S.string('Note id'),
          title: S.string('New title'),
          body: { description: 'New body: string or BlockNote blocks', type: ['string', 'array'] },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['id'],
      },
    },
    {
      name: 'list_tasks',
      description: 'List tasks, optionally filtered by state, sorted by due date.',
      inputSchema: {
        type: 'object',
        properties: { state: { type: 'string', enum: ['all', 'open', 'done'], description: 'Which tasks (default all)' } },
      },
    },
    {
      name: 'query_tasks',
      description: 'Agenda query: tasks filtered by due date and state. E.g. everything open and due before a date (overdue/upcoming views).',
      inputSchema: {
        type: 'object',
        properties: {
          due_before: S.date('Only tasks whose due date is strictly before this'),
          due_after: S.date('Only tasks whose due date is strictly after this'),
          state: { type: 'string', enum: ['all', 'open', 'done'], description: 'Which tasks (default open)' },
        },
      },
    },
    {
      name: 'add_task',
      description: 'Create a task with an optional due date.',
      inputSchema: {
        type: 'object',
        properties: { title: S.string('Task title'), due: S.date('Optional due date') },
        required: ['title'],
      },
    },
    {
      name: 'complete_task',
      description: 'Mark a task done (or reopen it with done=false).',
      inputSchema: {
        type: 'object',
        properties: { id: S.string('Task id'), done: { type: 'boolean', description: 'Default true' } },
        required: ['id'],
      },
    },
    {
      name: 'add_subtask',
      description: 'Append a checklist subtask to a task.',
      inputSchema: {
        type: 'object',
        properties: { id: S.string('Task id'), title: S.string('Subtask title') },
        required: ['id', 'title'],
      },
    },
    {
      name: 'add_attachment',
      description: 'Attach a file (base64) to a note or task; it syncs up to Drive on the next round.',
      inputSchema: {
        type: 'object',
        properties: {
          id: S.string('Item id'),
          name: S.string('File name'),
          mime: S.string('MIME type (default application/octet-stream)'),
          data: S.string('File contents, base64-encoded'),
        },
        required: ['id', 'data'],
      },
    },
    {
      name: 'delete_item',
      description: 'Delete a note or task (tombstoned; syncs the deletion to Drive).',
      inputSchema: { type: 'object', properties: { id: S.string('Item id') }, required: ['id'] },
    },
  ];
}

// Map a tool name + arguments to the domain API. Returns a plain JS value that
// gets JSON-stringified into the tool's text content.
async function runTool(api, name, args = {}) {
  switch (name) {
    case 'search_notes': return api.searchNotes(args.query || '', { limit: args.limit });
    case 'get_note': return api.getNote(args.id);
    case 'create_note': return api.createNote(args);
    case 'patch_note': return api.patchNote(args.id, args);
    case 'list_tasks': return api.listTasks({ state: args.state });
    case 'query_tasks': return api.queryTasks(args);
    case 'add_task': return api.addTask(args);
    case 'complete_task': return api.completeTask(args.id, args.done ?? true);
    case 'add_subtask': return api.addSubtask(args.id, args.title);
    case 'add_attachment': return api.addAttachment(args.id, args);
    case 'delete_item': return api.deleteItem(args.id);
    default: throw Object.assign(new Error(`unknown tool: ${name}`), { code: -32601 });
  }
}

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const err = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

export function createMcpHandler(api, { serverInfo = { name: 'nisaba', version: '1.0.0' } } = {}) {
  // Handle one JSON-RPC message. Returns a response object, or null for
  // notifications (which get no reply).
  async function handleOne(msg) {
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return err(msg?.id ?? null, -32600, 'invalid request');
    }
    const { id, method, params } = msg;
    const isNotification = id === undefined || id === null;

    try {
      switch (method) {
        case 'initialize':
          return ok(id, {
            protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo,
          });
        case 'notifications/initialized':
        case 'initialized':
          return null; // notification, no reply
        case 'ping':
          return ok(id, {});
        case 'tools/list':
          return ok(id, { tools: toolDefs() });
        case 'tools/call': {
          const { name, arguments: args } = params || {};
          try {
            const result = await runTool(api, name, args || {});
            return ok(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
          } catch (e) {
            // Tool errors are reported in-band (isError) per MCP, not as RPC errors.
            return ok(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
          }
        }
        default:
          return isNotification ? null : err(id, -32601, `method not found: ${method}`);
      }
    } catch (e) {
      return isNotification ? null : err(id, -32603, e.message);
    }
  }

  return {
    protocolVersion: PROTOCOL_VERSION,
    // Accepts a single message or a batch array; mirrors the shape back.
    async handle(payload) {
      if (Array.isArray(payload)) {
        const out = [];
        for (const m of payload) {
          const r = await handleOne(m);
          if (r) out.push(r);
        }
        return out.length ? out : null;
      }
      return handleOne(payload);
    },
  };
}
