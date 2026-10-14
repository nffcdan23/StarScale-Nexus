// Made-up people and records used by every security check. Each check loads
// them inside a transaction that is rolled back, so nothing is left behind.

export const ids = {
  owner: '11111111-1111-4111-8111-111111111111',
  tv: '22222222-2222-4222-8222-222222222222',
  otherOwner: '33333333-3333-4333-8333-333333333333',
  stranger: '44444444-4444-4444-8444-444444444444',
  contextVisible: 'aaaaaaaa-0000-4000-8000-000000000001',
  contextPrivate: 'aaaaaaaa-0000-4000-8000-000000000002',
  contextOther: 'aaaaaaaa-0000-4000-8000-000000000003',
  taskVisible: 'bbbbbbbb-0000-4000-8000-000000000001',
  taskDone: 'bbbbbbbb-0000-4000-8000-000000000004',
  taskArchived: 'bbbbbbbb-0000-4000-8000-000000000005',
  taskOther: 'bbbbbbbb-0000-4000-8000-000000000006',
}

/** Text that must never reach the TV. */
export const secretNote = 'SECRET-NOTE-DO-NOT-SHOW'

/**
 * Who is asking. "role" and "claims" are what the Supabase Data API hands
 * the database for that kind of visitor.
 */
export const identities = {
  anonymous: {
    label: 'Not signed in',
    role: 'anon',
    claims: { role: 'anon' },
  },
  tv: {
    label: 'TV sign-in',
    role: 'authenticated',
    claims: { sub: ids.tv, role: 'authenticated', aal: 'aal1' },
  },
  ownerNoCode: {
    label: 'Owner, no authenticator code',
    role: 'authenticated',
    claims: { sub: ids.owner, role: 'authenticated', aal: 'aal1' },
  },
  ownerWithCode: {
    label: 'Owner, with authenticator code',
    role: 'authenticated',
    claims: { sub: ids.owner, role: 'authenticated', aal: 'aal2' },
  },
  tvWithCode: {
    label: 'TV sign-in that enrolled its own authenticator',
    role: 'authenticated',
    claims: { sub: ids.tv, role: 'authenticated', aal: 'aal2' },
  },
  strangerWithCode: {
    label: 'Unregistered sign-in, with authenticator code',
    role: 'authenticated',
    claims: { sub: ids.stranger, role: 'authenticated', aal: 'aal2' },
  },
}

/** Run as the database administrator before each check. */
export const seedSql = `
insert into auth.users (id) values
  ('${ids.owner}'), ('${ids.tv}'), ('${ids.otherOwner}'), ('${ids.stranger}');

insert into private.identities (user_id, kind, owner_id, label) values
  ('${ids.owner}', 'owner', null, 'Owner'),
  ('${ids.tv}', 'tv', '${ids.owner}', 'Office TV'),
  ('${ids.otherOwner}', 'owner', null, 'A second owner');

insert into public.contexts (id, owner_id, name, slug, show_on_tv) values
  ('${ids.contextVisible}', '${ids.owner}', 'StarScale', 'starscale', true),
  ('${ids.contextPrivate}', '${ids.owner}', 'Personal', 'personal', false),
  ('${ids.contextOther}', '${ids.otherOwner}', 'Elsewhere', 'elsewhere', true);

insert into public.tasks (id, owner_id, context_id, title, notes, status, hide_from_tv, archived_at) values
  ('${ids.taskVisible}', '${ids.owner}', '${ids.contextVisible}', 'Visible task', '${secretNote}', 'open', false, null),
  ('bbbbbbbb-0000-4000-8000-000000000002', '${ids.owner}', '${ids.contextVisible}', 'Hidden task', null, 'open', true, null),
  ('bbbbbbbb-0000-4000-8000-000000000003', '${ids.owner}', '${ids.contextPrivate}', 'Private context task', null, 'open', false, null),
  ('bbbbbbbb-0000-4000-8000-000000000004', '${ids.owner}', '${ids.contextVisible}', 'Finished task', null, 'done', false, null),
  ('bbbbbbbb-0000-4000-8000-000000000005', '${ids.owner}', '${ids.contextVisible}', 'Archived task', null, 'open', false, now()),
  ('${ids.taskOther}', '${ids.otherOwner}', '${ids.contextOther}', 'Other owner task', null, 'open', false, null);
`
