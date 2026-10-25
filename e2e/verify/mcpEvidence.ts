import { Schema } from "effect";

export function mcpExchangeName(sequence: number, method: string): string {
  return `${exchangePrefix}${sequence}: ${method}`;
}

export function isMcpExchangeAttachment(attachment: { readonly name: string }): boolean {
  return attachment.name.startsWith(exchangePrefix);
}

const exchangePrefix = "MCP exchange ";

const McpExchange = Schema.Struct({
  persona: Schema.String,
  method: Schema.String,
  url: Schema.String,
  rpcMethod: Schema.optional(Schema.String),
  tool: Schema.optional(Schema.String),
  arguments: Schema.optional(Schema.Unknown),
  traceId: Schema.String,
  request: Schema.Unknown,
  status: Schema.Number,
  response: Schema.Unknown,
});
export const McpExchangeJson = Schema.fromJsonString(McpExchange);
