-- Issue #14 feedback reply claim authorization behavior.
-- The RPCs intentionally remain service_role-only. The service-role test
-- context below passes the server-verified actor explicitly.
create extension if not exists pgtap;

begin;
select plan(43);

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
  ('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'OTHER', 'issue14 revoke'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'OTHER', 'issue14 sent recovery'),
  ('99999999-9999-9999-9999-999999999999'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'OTHER', 'issue14 persistPending recovery');

-- Service-role transport does not identify the web-session actor. Authorization
-- therefore depends on the explicit server-verified actor membership.
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
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
  'not_sent recovery releases the claim'
);
select ok(
  (select public.admin_claim_feedback_reply('cccccccc-cccc-cccc-cccc-cccccccccccc', 'cccccccc-cccc-cccc-cccc-cccccccc0002', 'reply three retry', '11111111-1111-1111-1111-111111111111')->>'ok') = 'true',
  'a released claim can be retried through the normal send path'
);
select ok(
  (select public.admin_claim_feedback_reply('cccccccc-cccc-cccc-cccc-cccccccccccc', 'cccccccc-cccc-cccc-cccc-cccccccc0003', 'reply three duplicate', '11111111-1111-1111-1111-111111111111')->>'reason') = 'in_progress',
  'an active claim cannot be duplicated'
);
select ok(
  (select public.admin_claim_feedback_reply('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0001', 'reply five', '11111111-1111-1111-1111-111111111111')->>'ok') = 'true',
  'current admin can create a claim for sent recovery'
);
select ok(
  (select public.admin_settle_feedback_reply_claim('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0001', 'UNCONFIRMED', 'unknown', '11111111-1111-1111-1111-111111111111')->>'state') = 'UNCONFIRMED',
  'claim is unconfirmed before sent recovery'
);
select ok(
  (select public.admin_recover_feedback_reply('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'sent', '11111111-1111-1111-1111-111111111111')->>'state') = 'SENT',
  'sent recovery records the stored reply as sent'
);
select ok(
  (select admin_reply from public.feedback where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee') = 'reply five',
  'sent recovery writes the stored reply body to the feedback row'
);
select ok(
  (select replied_by from public.feedback where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee') = '11111111-1111-1111-1111-111111111111'::uuid,
  'sent recovery attributes the reply to the stored actor'
);
select ok(
  (select state from public.feedback_reply_attempts where feedback_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee') = 'SENT',
  'sent recovery marks the attempt terminal'
);
select ok(
  (select public.admin_recover_feedback_reply('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'sent', '11111111-1111-1111-1111-111111111111')->>'changed') = 'false',
  'recovering a terminal attempt is a no-op'
);
select ok(
  (select public.admin_claim_feedback_reply('99999999-9999-9999-9999-999999999999', '99999999-9999-9999-9999-999999999991', 'reply six', '11111111-1111-1111-1111-111111111111')->>'ok') = 'true',
  'current admin can create a persistPending claim'
);
select ok(
  (select state from public.feedback_reply_attempts where feedback_id = '99999999-9999-9999-9999-999999999999') = 'SENDING',
  'persistPending attempt remains SENDING after a finalize failure'
);
select ok(
  (select public.admin_recover_feedback_reply('99999999-9999-9999-9999-999999999999', 'sent', '11111111-1111-1111-1111-111111111111')->>'state') = 'SENT',
  'sent recovery resolves a persistPending attempt without resending'
);
select ok(
  (select admin_reply from public.feedback where id = '99999999-9999-9999-9999-999999999999') = 'reply six',
  'persistPending recovery records the stored reply body'
);
select ok(
  (select replied_by from public.feedback where id = '99999999-9999-9999-9999-999999999999') = '11111111-1111-1111-1111-111111111111'::uuid,
  'persistPending recovery attributes the reply to the stored actor'
);
select ok(
  (select state from public.feedback_reply_attempts where feedback_id = '99999999-9999-9999-9999-999999999999') = 'SENT',
  'persistPending recovery marks the attempt terminal'
);
select ok(
  (select public.admin_recover_feedback_reply('99999999-9999-9999-9999-999999999999', 'sent', '11111111-1111-1111-1111-111111111111')->>'changed') = 'false',
  'a recovered persistPending attempt is a no-op'
);
select throws_ok(
  $$select public.admin_recover_feedback_reply('ffffffff-ffff-ffff-ffff-ffffffffffff', 'not_sent', '11111111-1111-1111-1111-111111111111')$$,
  '02000', 'reply attempt not found', 'missing attempt is reported clearly'
);
select throws_ok(
  $$select public.admin_recover_feedback_reply('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'maybe', '11111111-1111-1111-1111-111111111111')$$,
  '22000', 'invalid recovery outcome', 'invalid recovery outcome is rejected'
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
select throws_ok(
  $$select public.admin_recover_feedback_reply('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'sent', '11111111-1111-1111-1111-111111111111')$$,
  '42501', 'not authorized', 'removed admin cannot confirm a sent reply'
);

reset role;
select ok(has_function_privilege('anon', 'public.admin_claim_feedback_reply(uuid,uuid,text,uuid)', 'EXECUTE') = false, 'anon cannot execute claim RPC');
select ok(has_function_privilege('authenticated', 'public.admin_finalize_feedback_reply(uuid,uuid,text,uuid)', 'EXECUTE') = false, 'authenticated cannot execute finalize RPC');
select ok(has_function_privilege('service_role', 'public.admin_recover_feedback_reply(uuid,text,uuid)', 'EXECUTE') = true, 'service role retains recovery RPC access');
select ok(has_function_privilege('anon', 'public.admin_recover_feedback_reply(uuid,text,uuid)', 'EXECUTE') = false, 'anon cannot execute recovery RPC');
select ok(has_function_privilege('authenticated', 'public.admin_recover_feedback_reply(uuid,text,uuid)', 'EXECUTE') = false, 'authenticated cannot execute recovery RPC');
select ok(has_table_privilege('anon', 'public.feedback_reply_attempts', 'SELECT') = false, 'anon cannot read attempt rows');
select ok(has_table_privilege('authenticated', 'public.feedback_reply_attempts', 'SELECT') = false, 'authenticated cannot read attempt rows');
select ok(has_table_privilege('service_role', 'public.feedback_reply_attempts', 'SELECT') = true, 'service role can read attempt rows');

select * from finish();
rollback;
