// Partner account deletion (App Store 5.1.1(v) / Play policy: an app that has sign-in must let people delete their
// account from inside the app). Called by the VINII Partner app with the signed-in person's token.
//
// What happens:
//   * The person is removed from every store team (org_users). If they are the ONLY owner of a store, deletion is
//     refused until another owner is added or the store is closed with support: a store must never be left with
//     nobody in charge of its orders and money.
//   * Partner applications they made that never became a store are deleted outright; an approved one keeps only the
//     business record the store needs (owner contact details are removed).
//   * Their login is deleted. Orders, invoices and payouts stay with the store, as tax law requires, with no link back.
import { signedInUserId } from './auth';
import { db, fromDbError } from './db';
import { HttpError, limit } from './http';

export async function deletePartnerAccount(request: Request, body: { confirm?: unknown }) {
  const userId = await signedInUserId(request);
  if (!userId) throw new HttpError(401, 'Please sign in again.');
  if (body?.confirm !== 'DELETE') throw new HttpError(400, 'Type DELETE to confirm.');
  limit(userId, 'partner-account-delete', 3, 86_400_000);

  const { data: teams, error } = await db().from('org_users').select('organization_id, status, role:roles(slug)').eq('user_id', userId);
  if (error) fromDbError(error);
  for (const t of (teams ?? []) as unknown as { organization_id: string; status: string; role: { slug: string } | null }[]) {
    if (t.role?.slug !== 'org_owner') continue;
    const { data: others, error: ownersError } = await db().from('org_users').select('user_id, status, role:roles(slug)')
      .eq('organization_id', t.organization_id).neq('user_id', userId);
    if (ownersError) fromDbError(ownersError);
    const otherOwners = ((others ?? []) as unknown as { status: string; role: { slug: string } | null }[])
      .filter(o => o.role?.slug === 'org_owner' && o.status === 'active').length;
    if (!otherOwners) throw new HttpError(409, 'You are the only owner of a store. Add another owner in the team settings, or contact OneLocal support to close the store, then delete your account.');
  }

  const { error: teamError } = await db().from('org_users').delete().eq('user_id', userId);
  if (teamError) fromDbError(teamError);
  const { data: apps } = await db().from('ol_partner_applications').select('id, status').eq('applicant_user_id', userId);
  for (const a of apps ?? []) {
    if (a.status === 'approved') await db().from('ol_partner_applications').update({ email: null, notes: null, applicant_user_id: null }).eq('id', a.id);
    else await db().from('ol_partner_applications').delete().eq('id', a.id);
  }
  const { error: authError } = await db().auth.admin.deleteUser(userId);
  if (authError) throw new HttpError(500, 'We could not delete your login right now. Please try again.');
  console.log(`[partner-account] deleted ${JSON.stringify({ at: new Date().toISOString(), user: userId.slice(0, 8), teams: teams?.length ?? 0, applications: apps?.length ?? 0 })}`);
  return { deleted: true };
}
