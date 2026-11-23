-- Issue #14 feedback reply claim authorization behavior.
-- The RPCs intentionally remain service_role-only. The service-role test
-- context below passes the server-verified actor explicitly.
create extension if not exists pgtap;

begin;
select plan(19);

-- Isolated users and feedback rows. The enclosing transaction rolls all of
-- this back, including admin membership changes.
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111'::uuid, 'authenticated', 'authenticated', 'issue14-admin@test', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222'::uuid, 'authenticated', 'authenticated', 'issue14-student@test', now(), now());

insert into public.admin_users (user_id)
values ('11111111-1111-1111-1111-111111111111'::uuid);

insert into public.feedback (id, user_id, category, message)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'OTHER', 'issue14 claim'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'OTHER', 'issue14 settle'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'OTHER', 'issue14 recover'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'OTHER', 'issue14 revoke');

-- Service-role transport does not identify the web-session actor. Authorization
-- therefore depends on the explicit server-verified actor membership.
set local role service_role;
select throws_ok(
  $$select public.admin_claim_feedback_reply('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001', 'reply', '22222222-2222-2222-2222-222222222222')$$,
  '42501', 'not authorized', 'authenticated non-admin cannot claim a reply'
);
-- Current admin can claim, finalize, settle, and recover valid claims.
select ok(
  (select public.admin_claim_feedback_reply('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001', 'reply one', '11111111-1111-1111-1111-111111111111')->>'ok') = 'true',
  'current admin can claim a reply'
);
select ok(
  (select public.admin_finalize_feedback_reply('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001', 'brevo-1', '11111111-1111-1111-1111-111111111111')->>'ok') = 'true',
  'current admin can finalize a reply'
);
select ok(
  (select public.admin_claim_feedback_reply('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0001', 'reply two', '11111111-1111-1111-1111-111111111111')->>'ok') = 'true',
  'current admin can create a claim for settlement'
);
select ok(
  (select public.admin_settle_feedback_reply_claim('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0001', 'RELEASED', 'not sent', '11111111-1111-1111-1111-111111111111')->>'state') = 'RELEASED',
  'current admin can settle a claim'
);
select ok(
  (select public.admin_claim_feedback_reply('cccccccc-cccc-cccc-cccc-cccccccccccc', 'cccccccc-cccc-cccc-cccc-cccccccc0001', 'reply three', '11111111-1111-1111-1111-111111111111')->>'ok') = 'true',
  'current admin can create a claim for recovery'
);
select ok(
  (select public.admin_settle_feedback_reply_claim('cccccccc-cccc-cccc-cccc-cccccccccccc', 'cccccccc-cccc-cccc-cccc-cccccccc0001', 'UNCONFIRMED', 'unknown', '11111111-1111-1111-1111-111111111111')->>'state') = 'UNCONFIRMED',
  'current admin can mark a claim unconfirmed'
);
select ok(
  (select public.admin_recover_feedback_reply('cccccccc-cccc-cccc-cccc-cccccccccccc', 'not_sent', '11111111-1111-1111-1111-111111111111')->>'state') = 'RELEASED',
  'current admin can recover a claim'
);

select throws_ok($$select public.admin_finalize_feedback_reply('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001', 'brevo-1', '22222222-2222-2222-2222-222222222222')$$, '42501', 'not authorized', 'non-admin cannot finalize an admin claim');
select throws_ok($$select public.admin_settle_feedback_reply_claim('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0001', 'UNCONFIRMED', 'changed', '22222222-2222-2222-2222-222222222222')$$, '42501', 'not authorized', 'non-admin cannot settle an admin claim');
select throws_ok($$select public.admin_recover_feedback_reply('cccccccc-cccc-cccc-cccc-cccccccccccc', 'not_sent', '22222222-2222-2222-2222-222222222222')$$, '42501', 'not authorized', 'non-admin cannot recover an admin claim');
select throws_ok($$select public.admin_claim_feedback_reply('dddddddd-dddd-dddd-dddd-dddddddddddd', 'dddddddd-dddd-dddd-dddd-dddddddd0001', 'reply four', '22222222-2222-2222-2222-222222222222')$$, '42501', 'not authorized', 'admin cannot impersonate a mismatched actor id');

-- Revoke the membership and verify every privileged RPC rejects subsequent
-- operations, including operations against claims created while authorized.
delete from public.admin_users
where user_id = '11111111-1111-1111-1111-111111111111'::uuid;

select throws_ok(
  $$select public.admin_claim_feedback_reply('dddddddd-dddd-dddd-dddd-dddddddddddd', 'dddddddd-dddd-dddd-dddd-dddddddd0001', 'reply four', '11111111-1111-1111-1111-111111111111')$$,
  '42501', 'not authorized', 'removed admin cannot claim a reply'
);
select throws_ok(
  $$select public.admin_finalize_feedback_reply('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001', 'brevo-1', '11111111-1111-1111-1111-111111111111')$$,
  '42501', 'not authorized', 'removed admin cannot finalize a reply'
);
select throws_ok(
  $$select public.admin_settle_feedback_reply_claim('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0001', 'UNCONFIRMED', 'changed', '11111111-1111-1111-1111-111111111111')$$,
  '42501', 'not authorized', 'removed admin cannot settle a claim'
);
select throws_ok(
  $$select public.admin_recover_feedback_reply('cccccccc-cccc-cccc-cccc-cccccccccccc', 'not_sent', '11111111-1111-1111-1111-111111111111')$$,
  '42501', 'not authorized', 'removed admin cannot recover a claim'
);

reset role;
select ok(has_function_privilege('anon', 'public.admin_claim_feedback_reply(uuid,uuid,text,uuid)', 'EXECUTE') = false, 'anon cannot execute claim RPC');
select ok(has_function_privilege('authenticated', 'public.admin_finalize_feedback_reply(uuid,uuid,text,uuid)', 'EXECUTE') = false, 'authenticated cannot execute finalize RPC');
select ok(has_function_privilege('service_role', 'public.admin_recover_feedback_reply(uuid,text,uuid)', 'EXECUTE') = true, 'service role retains recovery RPC access');

select * from finish();
rollback;
