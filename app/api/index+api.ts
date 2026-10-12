import { json, route } from '../../server/http';

export const GET = route(() => json({ message: 'One Latur API' }));
