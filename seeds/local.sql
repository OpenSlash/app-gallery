-- Local-only fixtures. Stable IDs and INSERT OR IGNORE preserve existing edits.
-- This file is intentionally outside the production migrations directory.
PRAGMA foreign_keys = ON;

WITH samples(n, name, description, type, category, icon, color, size, favorite) AS (
  VALUES
    (1, 'Paper Notes', '模拟应用：写下灵感、整理文档，让想法慢慢生长。', 'website', '工作效率', 'reader', 'forest', 'small', 1),
    (2, 'Cloud Console', '模拟服务：集中管理域名、边缘函数和项目资源。', 'service', '基础设施', 'cloud', 'orange', 'medium', 1),
    (3, 'Code Studio', '模拟 App：在线开发环境，从一个想法到下一次发布。', 'app', '开发工具', 'code', 'slate', 'small', 1),
    (4, 'Photo Library', '模拟应用：收集日常里的微小瞬间，整理照片与创作素材。', 'website', '生活与创作', 'image', 'rose', 'large', 1),
    (5, 'Data Studio', '模拟服务：查看项目数据、管理表结构和数据库查询。', 'service', '基础设施', 'database', 'teal', 'small', 1),
    (6, 'Read Later', '模拟 App：留给周末的好文章，暂时停下来也没关系。', 'app', '工作效率', 'reader', 'blue', 'medium', 0),
    (7, 'Portfolio', '模拟网站：设计、代码，以及那些值得展示的小作品。', 'website', '生活与创作', 'globe', 'forest', 'medium', 0),
    (8, 'Release Board', '模拟应用：记录版本、发布计划和每一个上线的日子。', 'app', '开发工具', 'rocket', 'orange', 'small', 0),
    (9, 'API Console', '模拟服务：接口调试、请求记录和服务文档的工作台。', 'service', '开发工具', 'dashboard', 'blue', 'small', 0),
    (10, 'Private Vault', '模拟服务：团队访问入口与权限配置，不存储真实凭据。', 'service', '基础设施', 'lock', 'slate', 'small', 0),
    (11, 'Music Box', '模拟 App：还在酝酿的音乐收藏项目，等待第一次上线。', 'app', '生活与创作', 'music', 'rose', 'large', 0),
    (12, 'Status Archive', '模拟网站：已经下线的旧版状态页，保留过去的发布记录。', 'website', '基础设施', 'gear', 'orange', 'small', 0)
)
INSERT OR IGNORE INTO applications
  (id, name, description, type, category, tags, icon, color, size, favorite, archived, created_at)
SELECT
  printf('a0000000-0000-4000-8000-%012d', n),
  name, description, type, category, json_array('模拟数据', category),
  icon, color, size, favorite, 0,
  (unixepoch('2026-11-10') - n * 3600) * 1000
FROM samples;

WITH samples(n, launched_on, status, retired_at) AS (
  VALUES
    (1, '2026-02-14', 'active', NULL),
    (2, '2026-04-02', 'active', NULL),
    (3, '2026-03-12', 'active', NULL),
    (4, '2026-06-18', 'active', NULL),
    (5, '2026-05-06', 'active', NULL),
    (6, '2026-10-01', 'paused', NULL),
    (7, '2026-07-09', 'active', NULL),
    (8, '2026-08-22', 'active', NULL),
    (9, '2026-09-03', 'active', NULL),
    (10, '2026-11-01', 'active', NULL),
    (11, NULL, 'draft', NULL),
    (12, '2026-01-20', 'retired', '2026-08-20')
)
INSERT OR IGNORE INTO deployments
  (id, application_id, environment, url, launched_on, retired_at, status, revision)
SELECT
  printf('b0000000-0000-4000-8000-%012d', n),
  printf('a0000000-0000-4000-8000-%012d', n),
  'production', 'https://example.com/?sample=' || n, launched_on,
  unixepoch(retired_at) * 1000, status, 0
FROM samples;

-- Seed history only for originally launched fixtures, never a later user launch.
INSERT OR IGNORE INTO events
  (id, deployment_id, kind, occurred_at, created_at, note, actor)
SELECT
  'sample-launch:' || id, id, 'launched',
  unixepoch(launched_on) * 1000, unixepoch(launched_on) * 1000,
  '模拟记录：首次上线（日期精度，UTC）', 'local-sample'
FROM deployments
WHERE id GLOB 'b0000000-0000-4000-8000-0000000000[0-1][0-9]'
  AND id != 'b0000000-0000-4000-8000-000000000011'
  AND launched_on IS NOT NULL;

WITH history(n, kind, date, note) AS (
  VALUES
    (1, 'released', '2026-09-16', '模拟发布 v1.4：新增 Markdown 文档与全文搜索。'),
    (2, 'released', '2026-10-08', '模拟发布 v2.1：接入项目资源概览。'),
    (3, 'paused', '2026-09-01', '模拟暂停：升级开发环境，暂停期间不累计启用时长。'),
    (3, 'resumed', '2026-09-08', '模拟恢复：环境升级完成，重新开始累计启用时长。'),
    (3, 'released', '2026-10-21', '模拟发布 v0.8：新增终端与项目模板。'),
    (4, 'released', '2026-10-12', '模拟发布 v1.2：优化相册分组与移动端浏览。'),
    (5, 'note', '2026-10-15', '模拟备注：数据库仅作台账示例，不包含真实业务资料。'),
    (6, 'paused', '2026-10-25', '模拟暂停：整理阅读源，恢复时间待定。'),
    (7, 'released', '2026-11-02', '模拟发布：更新年度作品集。'),
    (8, 'released', '2026-11-04', '模拟发布 v0.3：增加版本时间线。'),
    (9, 'note', '2026-10-28', '模拟备注：统一接口文档入口。'),
    (10, 'note', '2026-11-06', '模拟备注：这里只记录访问入口，不保管密码。'),
    (11, 'note', '2026-11-07', '模拟记录：原型设计中，尚未正式上线。'),
    (12, 'released', '2026-06-10', '模拟发布 v1.0：旧版状态页最后一次更新。'),
    (12, 'retired', '2026-08-20', '模拟下线：旧版状态页停止使用，历史记录保留。')
)
INSERT OR IGNORE INTO events
  (id, deployment_id, kind, occurred_at, created_at, note, actor)
SELECT
  'sample-history:' || n || ':' || kind,
  printf('b0000000-0000-4000-8000-%012d', n),
  kind, unixepoch(date) * 1000, unixepoch(date) * 1000, note, 'local-sample'
FROM history;

INSERT OR IGNORE INTO lifecycle_periods (id, deployment_id, started_at, ended_at)
SELECT
  'sample-period:' || id, id, unixepoch(launched_on) * 1000,
  CASE id
    WHEN 'b0000000-0000-4000-8000-000000000003' THEN unixepoch('2026-09-01') * 1000
    WHEN 'b0000000-0000-4000-8000-000000000006' THEN unixepoch('2026-10-25') * 1000
    WHEN 'b0000000-0000-4000-8000-000000000012' THEN unixepoch('2026-08-20') * 1000
    ELSE NULL
  END
FROM deployments
WHERE id GLOB 'b0000000-0000-4000-8000-0000000000[0-1][0-9]'
  AND id != 'b0000000-0000-4000-8000-000000000011'
  AND launched_on IS NOT NULL;

INSERT OR IGNORE INTO lifecycle_periods (id, deployment_id, started_at, ended_at)
VALUES (
  'sample-period:code-studio-resumed',
  'b0000000-0000-4000-8000-000000000003',
  unixepoch('2026-09-08') * 1000,
  NULL
);
