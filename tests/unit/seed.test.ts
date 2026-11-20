import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(new URL('../../drizzle/0001_initial.sql', import.meta.url), 'utf8')
const seed = readFileSync(new URL('../../seeds/local.sql', import.meta.url), 'utf8')

function withDatabase(run: (db: DatabaseSync) => void) {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(migration)
    db.exec(seed)
    run(db)
  } finally { db.close() }
}

describe('本地模拟数据', () => {
  it('包含 12 个应用，覆盖全部生命周期状态和尺寸', () => withDatabase(db => {
    expect(db.prepare('SELECT COUNT(*) AS n FROM applications').get()?.n).toBe(12)
    expect(db.prepare('SELECT COUNT(DISTINCT status) AS n FROM deployments').get()?.n).toBe(4)
    expect(db.prepare('SELECT COUNT(DISTINCT size) AS n FROM applications').get()?.n).toBe(3)
    expect(db.prepare('SELECT COUNT(*) AS n FROM applications WHERE favorite=1').get()?.n).toBe(5)
    expect(db.prepare('SELECT COUNT(*) AS n FROM events').get()?.n).toBe(26)
    expect(db.prepare('SELECT COUNT(*) AS n FROM lifecycle_periods').get()?.n).toBe(12)
    expect(db.prepare("SELECT COUNT(*) AS n FROM applications WHERE tags LIKE '%模拟数据%'").get()?.n).toBe(12)
    expect(db.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0)
  }))

  it('重复填充不新增记录、不覆盖编辑或归档', () => withDatabase(db => {
    db.exec("UPDATE applications SET name='我编辑的名称', size='large', archived=1 WHERE id='a0000000-0000-4000-8000-000000000001'")
    db.exec(seed)
    expect(db.prepare('SELECT COUNT(*) AS n FROM applications').get()?.n).toBe(12)
    expect(db.prepare('SELECT COUNT(*) AS n FROM events').get()?.n).toBe(26)
    expect(db.prepare('SELECT COUNT(*) AS n FROM lifecycle_periods').get()?.n).toBe(12)
    const row = db.prepare("SELECT name, size, archived FROM applications WHERE id='a0000000-0000-4000-8000-000000000001'").get()
    expect(row).toMatchObject({ name: '我编辑的名称', size: 'large', archived: 1 })
  }))

  it('暂停和下线区间已结束，恢复应用有两个不重叠区间', () => withDatabase(db => {
    const rows = db.prepare(`
      SELECT d.status, COUNT(p.id) AS periods,
        SUM(CASE WHEN p.id IS NOT NULL AND p.ended_at IS NULL THEN 1 ELSE 0 END) AS open
      FROM deployments d LEFT JOIN lifecycle_periods p ON p.deployment_id=d.id GROUP BY d.id
    `).all()
    for (const row of rows) expect(row.open).toBe(row.status === 'active' ? 1 : 0)
    const periods = db.prepare("SELECT started_at, ended_at FROM lifecycle_periods WHERE deployment_id='b0000000-0000-4000-8000-000000000003' ORDER BY started_at").all()
    expect(periods).toHaveLength(2)
    expect(Number(periods[0].ended_at)).toBeLessThan(Number(periods[1].started_at))
  }))

  it('用户将模拟草稿上线后，重跑不会补造额外的首次上线记录', () => withDatabase(db => {
    db.exec(`
      UPDATE deployments SET status='active', launched_on='2026-11-15', revision=1
      WHERE id='b0000000-0000-4000-8000-000000000011';
      INSERT INTO events (id, deployment_id, kind, occurred_at, created_at, note, actor)
      VALUES ('user-launch', 'b0000000-0000-4000-8000-000000000011', 'launched',
        unixepoch('2026-11-15')*1000, unixepoch('2026-11-15')*1000, '', 'user');
      INSERT INTO lifecycle_periods (id, deployment_id, started_at)
      VALUES ('user-period', 'b0000000-0000-4000-8000-000000000011', unixepoch('2026-11-15')*1000);
    `)
    db.exec(seed)
    expect(db.prepare("SELECT COUNT(*) AS n FROM events WHERE deployment_id='b0000000-0000-4000-8000-000000000011' AND kind='launched'").get()?.n).toBe(1)
    expect(db.prepare("SELECT COUNT(*) AS n FROM lifecycle_periods WHERE deployment_id='b0000000-0000-4000-8000-000000000011'").get()?.n).toBe(1)
  }))
})
