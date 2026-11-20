import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { maxIconBytes, validIconContent } from '../../src/shared/icons'

describe('Application icons', () => {
  it('migrates existing records without changing their original icons or lifecycle', () => {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec(readFileSync(new URL('../../drizzle/0001_initial.sql', import.meta.url), 'utf8'))
      db.exec(readFileSync(new URL('../../seeds/local.sql', import.meta.url), 'utf8'))
      const before = db.prepare('SELECT id, icon FROM applications ORDER BY id').all()
      db.exec(readFileSync(new URL('../../drizzle/0005_application_icons.sql', import.meta.url), 'utf8'))
      db.exec(readFileSync(new URL('../../drizzle/0006_uploaded_icons.sql', import.meta.url), 'utf8'))
      expect(db.prepare('SELECT id, icon FROM applications ORDER BY id').all()).toEqual(before)
      expect(db.prepare("SELECT COUNT(*) AS n FROM applications WHERE icon_url=''").get()?.n).toBe(12)
      expect(db.prepare('SELECT COUNT(*) AS n FROM events').get()?.n).toBe(26)
      expect(db.prepare('SELECT COUNT(*) AS n FROM uploaded_icons').get()?.n).toBe(0)
      expect(db.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0)
    } finally { db.close() }
  })

  it('accepts static SVG but rejects scripts, external resources and oversized icons', () => {
    const encode = (text: string) => new TextEncoder().encode(text)
    expect(validIconContent(encode('<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>'), 'image/svg+xml')).toBe(true)
    for (const content of ['<html>not an image</html>', '<svg><script>alert(1)</script></svg>',
      '<svg onload="alert(1)"/>', '<svg><foreignObject/></svg>', '<svg><use href="https://example.com/a.svg"/></svg>',
      '<!DOCTYPE svg><svg/>', '<svg><style>circle{fill:url(https://example.com/a)}</style></svg>']) {
      expect(validIconContent(encode(content), 'image/svg+xml')).toBe(false)
    }
    expect(validIconContent(new Uint8Array(maxIconBytes + 1), 'image/png')).toBe(false)
    expect(validIconContent(encode('<svg/>'), 'image/png')).toBe(false)
    expect(validIconContent(encode('<svg/>'), 'text/html')).toBe(false)
  })
})
