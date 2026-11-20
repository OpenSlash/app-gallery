import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const applications = sqliteTable('applications', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  type: text('type').notNull(),
  category: text('category').notNull(),
  tags: text('tags', { mode: 'json' }).$type<string[]>().notNull(),
  icon: text('icon').notNull(),
  iconUrl: text('icon_url').notNull().default(''),
  color: text('color').notNull(),
  size: text('size').notNull(),
  favorite: integer('favorite', { mode: 'boolean' }).notNull(),
  archived: integer('archived', { mode: 'boolean' }).notNull(),
  createdAt: integer('created_at').notNull(),
})
