// VINII Partner (restaurant order-accepting app): who is calling and what they may do.
// Staff sign in with their existing email accounts (Supabase Auth); membership and role come
// from the OS tables org_users and roles. See docs/PRD_VINII_PARTNER_V1.md (PD5).
import { signedInUserId } from './auth';
import { db, fromDbError } from './db';
import { HttpError } from './http';

export type Action = 'accept' | 'reject' | 'ready' | 'out' | 'delivered' | 'outlet' | 'items' | 'view';

const CAN: Record<Exclude<Action, 'view'>, string[]> = {
  accept: ['org_owner', 'org_admin', 'manager', 'biller', 'location_manager', 'operations_manager'],
  reject: ['org_owner', 'org_admin', 'manager', 'biller', 'location_manager', 'operations_manager'],
  outlet: ['org_owner', 'org_admin', 'manager', 'location_manager', 'operations_manager'],
  items: ['org_owner', 'org_admin', 'manager', 'location_manager', 'operations_manager', 'kitchen'],
  ready: ['org_owner', 'org_admin', 'manager', 'biller', 'kitchen', 'location_manager', 'operations_manager'],
  out: ['org_owner', 'org_admin', 'manager', 'biller', 'location_manager', 'operations_manager'],
  delivered: ['org_owner', 'org_admin', 'manager', 'biller', 'location_manager', 'operations_manager'],
};

export type Staff = { userId: string; email: string; name: string; role: string; organizationId: string; organizationName: string };

export async function requirePartnerAuth(request: Request): Promise<Staff> {
  const userId = await signedInUserId(request);
  if (!userId) throw new HttpError(401, 'Sign in to continue.');

  // Column names follow the OS schema (Repo-1- 0004): `full_name`, `status`, and roles matched by
  // `slug`. A person on staff at several restaurants gets their earliest membership until the app
  // lets them choose one.
  const { data, error } = await db().from('org_users')
    .select('user_id, email, full_name, role:roles(slug), organization:organizations(id, name)')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) fromDbError(error);
  if (!data) throw new HttpError(403, 'You are not a staff member of any restaurant on One Local.');

  const roleName = (data.role as { slug?: string } | null)?.slug ?? '';
  const org = data.organization as { id?: string; name?: string } | null;
  if (!org?.id) throw new HttpError(403, 'Restaurant not found.');

  return {
    userId,
    email: data.email ?? '',
    name: data.full_name ?? '',
    role: roleName,
    organizationId: org.id,
    organizationName: org.name ?? '',
  };
}

export function can(staff: Staff, action: Action): boolean {
  if (action === 'view') return true;
  return CAN[action].includes(staff.role);
}

export function require(staff: Staff, action: Action) {
  if (can(staff, action)) return;
  throw new HttpError(403, 'You do not have permission to do that.');
}
