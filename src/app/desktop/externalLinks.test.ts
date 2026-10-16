import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleExternalLinks } from './externalLinks'

// The desktop app's link rule, tested in the browser imitation (jsdom).

let stop: () => void = () => {}
afterEach(() => {
  stop()
  document.body.innerHTML = ''
})

function clickLink(href: string, options: { target?: string; button?: number } = {}) {
  const link = document.createElement('a')
  link.setAttribute('href', href)
  if (options.target) link.target = options.target
  link.textContent = 'link'
  document.body.append(link)
  const event = new MouseEvent(options.button === 1 ? 'auxclick' : 'click', { bubbles: true, cancelable: true, button: options.button ?? 0 })
  link.dispatchEvent(event)
  return event
}

describe('links in the desktop app', () => {
  it('opens web and email links in the default browser instead of the app window', () => {
    const open = vi.fn<(url: string) => Promise<void>>(async () => {})
    stop = handleExternalLinks(open)
    for (const href of ['https://example.com/page', 'http://example.com', 'mailto:me@example.com']) {
      expect(clickLink(href, { target: '_blank' }).defaultPrevented).toBe(true)
    }
    expect(open.mock.calls.map(([url]) => url)).toEqual(['https://example.com/page', 'http://example.com/', 'mailto:me@example.com'])
  })

  it('also catches middle-clicks', () => {
    const open = vi.fn<(url: string) => Promise<void>>(async () => {})
    stop = handleExternalLinks(open)
    expect(clickLink('https://example.com', { button: 1 }).defaultPrevented).toBe(true)
    expect(open).toHaveBeenCalledWith('https://example.com/')
  })

  it('refuses every other kind of link, opening nothing', () => {
    const open = vi.fn<(url: string) => Promise<void>>(async () => {})
    stop = handleExternalLinks(open)
    for (const href of ['javascript:alert(1)', 'file:///C:/Windows/system32', 'data:text/html,x', 'ftp://example.com']) {
      expect(clickLink(href).defaultPrevented).toBe(true)
    }
    expect(open).not.toHaveBeenCalled()
  })

  it('leaves links within Nexus to the app', () => {
    const open = vi.fn<(url: string) => Promise<void>>(async () => {})
    stop = handleExternalLinks(open)
    expect(clickLink('/notes').defaultPrevented).toBe(false)
    expect(clickLink(`${location.origin}/tasks`).defaultPrevented).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })

  it('stops when asked', () => {
    const open = vi.fn<(url: string) => Promise<void>>(async () => {})
    handleExternalLinks(open)()
    expect(clickLink('https://example.com').defaultPrevented).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })
})
