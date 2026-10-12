import { json, route } from '../../../server/http';
import { raiseGrievance } from '../../../server/privacy';

// A privacy grievance or a correction request, answered within the published period.
export const POST = route(async request => json(await raiseGrievance(request)));
