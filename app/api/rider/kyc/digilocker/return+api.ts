import { route } from '../../../../../server/http';
import { digilockerReturn } from '../../../../../server/rider-kyc';

// GET /api/rider/kyc/digilocker/return?v=  where DigiLocker sends the rider's browser after consent. Public, carries no data, and sends the
// rider back into the app; the result is read from Cashfree with the rider's own sign-in.
export const GET = route(async request => digilockerReturn(request));
