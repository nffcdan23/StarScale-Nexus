import { describe, expect, it } from 'vitest'
import { toLinkAddress } from './links'

describe('toLinkAddress', () => {
  it('keeps web and email addresses, adding https:// to bare ones', () => {
    expect(toLinkAddress(' https://example.com/a?b=c ')).toBe('https://example.com/a?b=c')
    expect(toLinkAddress('mailto:me@example.com')).toBe('mailto:me@example.com')
    expect(toLinkAddress('example.com')).toBe('https://example.com')
    expect(toLinkAddress('www.example.co.uk/page')).toBe('https://www.example.co.uk/page')
  })

  it('refuses anything else', () => {
    for (const input of ['', '   ', 'javascript:alert(1)', 'data:text/html,x', 'ftp://example.com', 'hello world', 'notes', '/relative']) {
      expect(toLinkAddress(input)).toBeNull()
    }
  })
})
