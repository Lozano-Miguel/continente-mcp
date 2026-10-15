import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, CallToolResultSchema, ListToolsRequestSchema, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';
import { ExecutionErrorSchema } from './contracts.js';
import { checkRequest, inRequest, RequestScope, RequestStopped } from '../session/request.js';
import type { RequestOptions } from '../session/request.js';

export interface ToolHandler {
  readonly definition: { name: string; title?: string; description?: string; annotations?: ToolAnnotations };
  readonly inputSchema: z.ZodType;
  readonly outputSchema?: z.ZodType;
  readonly cartMutation?: boolean;
  execute(input: unknown): Promise<CallToolResult>;
}
export interface McpServerOptions {
  readonly version: string;
  readonly tools: readonly ToolHandler[];
  readonly closeResources?: () => Promise<void>;
  readonly requestTimeoutMs?: number;
}
export class ContinenteMcpServer {
  private readonly server: McpServer;
  private readonly handlers = new Map<string, ToolHandler>();
  private cleanup: Promise<void> | undefined;
  private readonly shutdown = new AbortController();
  constructor(private readonly options: McpServerOptions) {
    this.server = new McpServer({ name: 'continentept-mcp', version: options.version }, { capabilities: { tools: {} } });
    for (const handler of options.tools) {
      if (this.handlers.has(handler.definition.name)) throw new Error(`Duplicate tool: ${handler.definition.name}`);
      this.handlers.set(handler.definition.name, handler);
    }
    this.server.server.onclose = () => { this.shutdown.abort(new RequestStopped('server_closed')); void this.closeResources().catch(() => {}); };
    this.registerTools();
  }
  private registerTools(): void {
    if (!this.handlers.size) this.server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
    for (const handler of this.handlers.values()) {
      const { name, ...metadata } = handler.definition;
      this.server.registerTool(name, { ...metadata, inputSchema: handler.inputSchema,
        ...(handler.outputSchema ? { outputSchema: handler.outputSchema } : {}) },
      input => this.dispatchToolCall(name, input));
    }
    // Replace the SDK's tools/call handler: it turns argument errors into text-only tool results
    // and skips output validation for errors. Matching on the method alone lets malformed params
    // surface as InvalidParams instead of InternalError.
    this.server.server.setRequestHandler(z.looseObject({ method: z.literal('tools/call') }), (raw, extra) => {
      const request = CallToolRequestSchema.parse(raw);
      if (request.params.task) throw new McpError(ErrorCode.InvalidParams, 'Task execution is not supported');
      const progressToken = request.params._meta?.progressToken;
      return this.dispatchToolCall(request.params.name, request.params.arguments ?? {}, { signal: extra.signal,
        ...(progressToken === undefined ? {} : { onProgress: progress => {
          void extra.sendNotification({ method: 'notifications/progress', params: { progressToken,
            progress: progress.completed, ...(progress.total === undefined ? {} : { total: progress.total }), message: progress.message } }).catch(() => {});
        } }),
      });
    });
  }
  async dispatchToolCall(name: string, input: unknown = {}, options: RequestOptions = {}): Promise<CallToolResult> {
    const scope = new RequestScope({ ...options, timeoutMs: options.timeoutMs ?? this.options.requestTimeoutMs ?? 45000,
      signal: options.signal ? AbortSignal.any([options.signal, this.shutdown.signal]) : this.shutdown.signal });
    try { return await inRequest(scope, () => this.execute(name, input, scope)); }
    finally { scope.dispose(); }
  }
  private async execute(name: string, input: unknown, scope: RequestScope): Promise<CallToolResult> {
    const handler = this.handlers.get(name);
    if (!handler) throw new McpError(ErrorCode.InvalidParams, `No tool named "${name}"`);
    const parsed = handler.inputSchema.safeParse(input);
    if (!parsed.success) throw new McpError(ErrorCode.InvalidParams, `Invalid arguments for ${name}`, {
      issues: parsed.error.issues.map(issue => ({ path: issue.path.map(String).join('.'), code: issue.code })),
    });
    let result: CallToolResult;
    try {
      checkRequest();
      result = await handler.execute(parsed.data);
      if (scope.signal.aborted && (result.structuredContent?.result as { status?: string } | undefined)?.status !== 'partial') throw scope.signal.reason;
    } catch (error) {
      if (error instanceof RequestStopped) return this.executionError(error.code, handler.cartMutation === true,
        scope.writeAttempted ? 'unknown' : 'not_applied');
      return this.executionError('internal_error', handler.cartMutation === true);
    }
    if (!CallToolResultSchema.safeParse(result).success) return this.executionError('invalid_result', handler.cartMutation === true);
    if (handler.outputSchema) {
      const validated = handler.outputSchema.safeParse(result.structuredContent);
      if (!validated.success) return this.executionError('invalid_result', handler.cartMutation === true);
      const failed = ExecutionErrorSchema.safeParse({ result: result.structuredContent?.result }).success;
      if (failed !== (result.isError === true)) return this.executionError('invalid_result', handler.cartMutation === true);
    }
    return result;
  }
  private executionError(code: 'internal_error' | 'invalid_result' | RequestStopped['code'], mutation: boolean, outcome: 'unknown' | 'not_applied' = 'unknown'): CallToolResult {
    process.stderr.write(`[continentept-mcp] ${code}\n`);
    const message = code === 'internal_error' ? 'The tool could not complete.' : code === 'invalid_result' ? 'The tool returned an invalid result.' :
      code === 'deadline_exceeded' ? 'The request deadline was exceeded.' : code === 'queue_full' ? 'The session queue is full.' :
      code === 'server_closed' ? 'The server is shutting down.' : 'The request was cancelled.';
    const structuredContent = ExecutionErrorSchema.parse({ result: { status: 'error', error: { code, message, retryable: false },
      ...(mutation ? { mutation: { outcome, ...(outcome === 'unknown' ? { recovery: { action: 'get_cart', automaticReplay: false } } : {}) } } : {}) } });
    return { isError: true, structuredContent, content: [{ type: 'text', text: message + (mutation && outcome === 'unknown' ? ' Use get_cart before another change.' : '') }] };
  }
  async connect(transport: Transport): Promise<void> { await this.server.connect(transport); }
  async close(): Promise<void> { this.shutdown.abort(new RequestStopped('server_closed')); await this.server.close(); await this.closeResources(); }
  private closeResources(): Promise<void> {
    this.cleanup ??= Promise.resolve().then(() => this.options.closeResources?.());
    return this.cleanup;
  }
}
