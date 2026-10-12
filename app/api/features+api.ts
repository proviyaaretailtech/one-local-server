import { features } from '../../server/features';
import { json, route } from '../../server/http';

// Which features the app should show as live vs "coming soon".
export const GET = route(() => json(features()));
