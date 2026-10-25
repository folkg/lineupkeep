# Provider-neutral fantasy management

The product will expose provider-neutral domain operations, including its MCP tools, and resolve the provider implementation from the fantasy team or other relevant owned resource. Provider-specific authentication, response decoding, rules, and action mechanics remain inside provider implementations; Yahoo is the first integration, not the product's domain model.

This supports future providers without making callers understand Yahoo keys or payloads. Yahoo NFL/NHL are the initial live integrations; ESPN, Fantrax, and additional sports are deferred. Shared interfaces include only what current use cases need: diamond cohorts and provider-specific projection variants remain private implementation details. No speculative capability framework is approved. Exact domain data contracts remain under discussion.
