-- Load-test clean-up (LOCAL database only). Removes every zz-load-*@example.test user, the checkouts / orders / delivery rows made for them,
-- their rider and partner rows, and the shared rate-limit counters. Append-only guard triggers are lifted only inside this transaction.
begin;
create temp table _u on commit drop as select id from auth.users where email like 'zz-load-%@example.test';
create temp table _h on commit drop as select encode(sha256(('user:' || id::text)::bytea), 'hex') as h from _u;
create temp table _o on commit drop as select id from public.ol_orders where user_id in (select id from _u) or customer_hash in (select h from _h);
create temp table _c on commit drop as select id from public.ol_checkouts where user_id in (select id from _u) or customer_hash in (select h from _h);
create temp table _r on commit drop as select id from public.riders where user_id in (select id from _u);
create temp table _j on commit drop as select id from public.delivery_jobs where ol_order_id in (select id from _o);
do $$
declare r record; t text; tabs text[] := '{}';
begin
  for r in select distinct c.conrelid::regclass::text as tbl from pg_constraint c
           where c.contype = 'f' and c.confrelid in ('public.ol_orders'::regclass, 'public.ol_checkouts'::regclass, 'public.riders'::regclass, 'public.delivery_jobs'::regclass) loop
    tabs := tabs || r.tbl;
  end loop;
  tabs := tabs || array['public.ol_orders','public.ol_checkouts','public.riders','public.delivery_jobs'];
  foreach t in array (select array_agg(distinct x) from unnest(tabs) x) loop
    execute format('alter table %s disable trigger user', t);
  end loop;
  -- children of jobs, orders, checkouts and riders (found from the foreign keys, so new ledger tables are covered)
  for r in select distinct c.conrelid::regclass::text as tbl, a.attname as col, c.confrelid::regclass::text as parent
           from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
           where c.contype = 'f' and c.confrelid in ('public.delivery_jobs'::regclass) and c.conrelid <> 'public.delivery_jobs'::regclass loop
    execute format('delete from %s where %I in (select id from _j)', r.tbl, r.col);
  end loop;
  delete from public.delivery_jobs where id in (select id from _j);
  for r in select distinct c.conrelid::regclass::text as tbl, a.attname as col
           from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
           where c.contype = 'f' and c.confrelid = 'public.ol_orders'::regclass and c.conrelid <> 'public.ol_orders'::regclass loop
    execute format('delete from %s where %I in (select id from _o)', r.tbl, r.col);
  end loop;
  delete from public.ol_orders where id in (select id from _o);
  for r in select distinct c.conrelid::regclass::text as tbl, a.attname as col
           from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
           where c.contype = 'f' and c.confrelid = 'public.ol_checkouts'::regclass and c.conrelid <> 'public.ol_checkouts'::regclass loop
    execute format('delete from %s where %I in (select id from _c)', r.tbl, r.col);
  end loop;
  delete from public.ol_checkouts where id in (select id from _c);
  for r in select distinct c.conrelid::regclass::text as tbl, a.attname as col
           from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
           where c.contype = 'f' and c.confrelid = 'public.riders'::regclass and c.conrelid <> 'public.riders'::regclass loop
    execute format('delete from %s where %I in (select id from _r)', r.tbl, r.col);
  end loop;
  delete from public.org_users where user_id in (select id from _u);
  delete from public.riders where id in (select id from _r);
  delete from public.ol_rate_limits;
  delete from auth.users where id in (select id from _u);
  foreach t in array (select array_agg(distinct x) from unnest(tabs) x) loop
    execute format('alter table %s enable trigger user', t);
  end loop;
end $$;
commit;
select 'remaining zz-load users: ' || count(*) from auth.users where email like 'zz-load-%@example.test';
select 'remaining riders named ZZ Load: ' || count(*) from public.riders where full_name like 'ZZ Load%';
select 'remaining orders notes ZZ-TEST load-test: ' || count(*) from public.ol_orders where delivery_address::text like '%ZZ-TEST load-test%';
