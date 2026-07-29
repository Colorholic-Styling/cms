import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('browser Liquid schema tag', () => {
  it('registers Shopify section schema as a non-rendering block tag', async () => {
    const response = await env.VIEWS.fetch('https://views.local/assets/liquid.browser.min.js');
    expect(response.ok).toBe(true);

    const source = await response.text();
    expect(source).toContain('class SchemaTag extends namespace.Tag');
    expect(source).toContain("token.name === 'endschema'");
    expect(source).toContain('namespace.tags.schema = SchemaTag');
  });
});
